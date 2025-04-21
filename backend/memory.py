"""
memory.py - Handles storage and retrieval of indexed web page content
Uses FAISS for vector similarity search with embeddings
"""

import logging
import json
import time
import os
import uuid
from typing import Dict, List, Any, Optional
from pathlib import Path
import numpy as np
import warnings
# Suppress FAISS warnings about AVX2 support
warnings.filterwarnings("ignore", message=".*AVX2.*")
import faiss
import requests

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Embedding configuration - using Nomic as specified in the requirements
EMBED_URL = "http://localhost:11434/api/embeddings"  # Default Ollama API URL
EMBED_MODEL = "nomic-embed-text"                      # Default model

class MemoryManager:
    """
    Manages the vector database for web page content storage and retrieval
    """
    def __init__(self, index_dir: Path):
        """
        Initialize the memory manager
        
        Args:
            index_dir: Directory to store the FAISS index and metadata
        """
        self.index_dir = index_dir
        self.index_dir.mkdir(parents=True, exist_ok=True)
        self.index_file = self.index_dir / "index.bin"
        self.metadata_file = self.index_dir / "metadata.json"
        
        # Initialize index and metadata
        self.index = None
        self.metadata = {}
        self.dimension = 768  # Default dimension for nomic-embed-text
        
        logger.info(f"Memory manager initialized with index directory: {self.index_dir}")
    
    def initialize(self):
        """Initialize or load the FAISS index and metadata"""
        try:
            if self.index_file.exists() and self.metadata_file.exists():
                logger.info("Loading existing FAISS index and metadata")
                self.index = faiss.read_index(str(self.index_file))
                with open(self.metadata_file, 'r') as f:
                    self.metadata = json.load(f)
            else:
                logger.info("Creating new FAISS index")
                self.index = faiss.IndexFlatL2(self.dimension)
                self.metadata = {}
                
            logger.info(f"Index initialized with {len(self.metadata)} documents")
            
        except Exception as e:
            logger.error(f"Error initializing index: {str(e)}", exc_info=True)
            # Create a new index if loading fails
            self.index = faiss.IndexFlatL2(self.dimension)
            self.metadata = {}
    
    def save(self):
        """Save the current index and metadata to disk"""
        try:
            faiss.write_index(self.index, str(self.index_file))
            with open(self.metadata_file, 'w') as f:
                json.dump(self.metadata, f)
            logger.info(f"Index saved with {len(self.metadata)} documents")
        except Exception as e:
            logger.error(f"Error saving index: {str(e)}", exc_info=True)

    def get_embedding(self, text: str) -> np.ndarray:
        """
        Get the embedding for a text using the Nomic model
        
        Args:
            text: Text to embed
            
        Returns:
            Numpy array with the embedding
        """
        try:
            # Using local Ollama API to get embeddings
            response = requests.post(EMBED_URL, json={"model": EMBED_MODEL, "prompt": text})
            response.raise_for_status()
            embedding = np.array(response.json()["embedding"], dtype=np.float32)
            return embedding
        except Exception as e:
            logger.error(f"Error getting embedding: {str(e)}", exc_info=True)
            raise

    def add_document(self, url: str, title: str, content: str, chunks: List[str]) -> str:
        """
        Add a document to the index
        
        Args:
            url: Document URL
            title: Document title
            content: Document content
            chunks: Document content in chunks
            
        Returns:
            Document ID
        """
        try:
            doc_id = str(uuid.uuid4())
            timestamp = time.time()
            
            # Process and index each chunk
            doc_embeddings = []
            chunk_ids = []
            
            for i, chunk in enumerate(chunks):
                if not chunk.strip():
                    continue
                    
                # Get embedding for the chunk
                embedding = self.get_embedding(chunk)
                doc_embeddings.append(embedding)
                
                # Generate chunk ID
                chunk_id = f"{doc_id}_{i}"
                chunk_ids.append(chunk_id)
                
                # Store chunk metadata
                self.metadata[chunk_id] = {
                    "doc_id": doc_id,
                    "url": url,
                    "title": title,
                    "content": chunk,
                    "position": i,
                    "timestamp": timestamp
                }
            
            # Add embeddings to the index
            if doc_embeddings:
                embeddings_array = np.array(doc_embeddings).astype('float32')
                self.index.add(embeddings_array)
                
                # Save the updated index
                self.save()
                
                logger.info(f"Added document {url} with {len(chunks)} chunks")
                return doc_id
            else:
                logger.warning(f"No embeddings generated for {url}")
                return None
                
        except Exception as e:
            logger.error(f"Error adding document {url}: {str(e)}", exc_info=True)
            raise

    def search(self, query: str, top_k: int = 5) -> List[Dict[str, Any]]:
        """
        Search for documents matching the query
        
        Args:
            query: Search query
            top_k: Number of results to return
            
        Returns:
            List of search results
        """
        try:
            # Get embedding for the query
            query_embedding = self.get_embedding(query)
            
            # Search the index - retrieve more candidates for reranking
            retrieve_k = min(top_k * 3, 15)  # Retrieve more candidates than needed for reranking
            D, I = self.index.search(np.array([query_embedding]), retrieve_k)
            
            results = []
            for i, (idx, distance) in enumerate(zip(I[0], D[0])):
                if idx < 0 or idx >= self.index.ntotal:
                    continue
                
                # Find the chunk ID for this index
                chunk_id = list(self.metadata.keys())[idx]
                chunk_data = self.metadata[chunk_id]
                
                # Advanced scoring - combine vector distance with BM25-style keyword matching
                # Lower distance means higher relevance
                vector_score = float(np.exp(-distance / 5))  # Steeper curve for better differentiation
                
                # Add keyword matching component
                keyword_score = self._calculate_keyword_score(query, chunk_data["content"])
                
                # Combined score with vector search having more weight (70/30 split)
                final_score = (0.7 * vector_score) + (0.3 * keyword_score)
                
                # Prepare snippet
                snippet = self._generate_snippet(query, chunk_data["content"])
                
                result = {
                    "url": chunk_data["url"],
                    "title": chunk_data["title"],
                    "content": chunk_data["content"],
                    "snippet": snippet,
                    "score": final_score,
                    "chunk_id": chunk_id
                }
                results.append(result)
            
            # Sort results by score in descending order
            results.sort(key=lambda x: x["score"], reverse=True)
            
            # Return top_k results after reranking
            results = results[:top_k]
            
            logger.info(f"Search for '{query}' returned {len(results)} results with scores: {[round(r['score'], 3) for r in results]}")
            return results
            
        except Exception as e:
            logger.error(f"Error searching for '{query}': {str(e)}", exc_info=True)
            return []
    
    def _calculate_keyword_score(self, query: str, content: str) -> float:
        """
        Calculate keyword matching score for improved relevance
        
        Args:
            query: Search query
            content: Document content
            
        Returns:
            Keyword matching score between 0 and 1
        """
        # Simple but effective keyword matching
        query_terms = [term.lower() for term in query.split() if len(term) > 2]
        if not query_terms:
            return 0.0
        
        content_lower = content.lower()
        
        # Count exact matches
        matches = sum(1 for term in query_terms if term in content_lower)
        
        # Count term frequencies for matched terms
        term_freq = sum(content_lower.count(term) for term in query_terms if term in content_lower)
        
        # Normalize by query length and apply a sigmoid to keep between 0-1
        base_score = matches / len(query_terms) if query_terms else 0
        freq_bonus = min(0.5, term_freq / 50)  # Cap frequency bonus at 0.5
        
        return base_score + freq_bonus * base_score
    
    def _generate_snippet(self, query: str, content: str, max_length: int = 200) -> str:
        """
        Generate a snippet from content based on query match
        
        Args:
            query: Search query
            content: Document content
            max_length: Maximum length of snippet
            
        Returns:
            Snippet text
        """
        # Find best matching section of content
        query_terms = [term.lower() for term in query.split() if len(term) > 2]
        if not query_terms or not content:
            return content[:max_length] + "..." if len(content) > max_length else content
        
        content_lower = content.lower()
        
        # Find positions of all query terms in content
        positions = []
        for term in query_terms:
            pos = content_lower.find(term)
            if pos >= 0:
                positions.append(pos)
        
        if not positions:
            return content[:max_length] + "..." if len(content) > max_length else content
        
        # Find center of matching terms
        center = sum(positions) // len(positions)
        
        # Extract snippet around center
        start = max(0, center - max_length // 2)
        end = min(len(content), center + max_length // 2)
        
        # Adjust to not cut words
        if start > 0:
            # Find first space before start
            adjust_start = content.rfind(" ", 0, start)
            if adjust_start > 0:
                start = adjust_start + 1
        
        if end < len(content):
            # Find first space after end
            adjust_end = content.find(" ", end)
            if adjust_end > 0:
                end = adjust_end
        
        snippet = content[start:end]
        
        # Add ellipsis if needed
        if start > 0:
            snippet = "..." + snippet
        if end < len(content):
            snippet = snippet + "..."
            
        return snippet

    def get_stats(self) -> Dict[str, Any]:
        """
        Get statistics about the index
        
        Returns:
            Dictionary with statistics
        """
        try:
            # Count unique URLs
            urls = set()
            for chunk_id, data in self.metadata.items():
                urls.add(data["url"])
                
            return {
                "total_chunks": len(self.metadata),
                "total_documents": len(urls),
                "index_size_bytes": os.path.getsize(self.index_file) if self.index_file.exists() else 0,
                "dimension": self.dimension
            }
            
        except Exception as e:
            logger.error(f"Error getting stats: {str(e)}", exc_info=True)
            return {
                "error": str(e)
            }

    def clear(self):
        """Clear the index"""
        try:
            # Create a new index
            self.index = faiss.IndexFlatL2(self.dimension)
            self.metadata = {}
            
            # Save the empty index
            self.save()
            logger.info("Index cleared")
            
        except Exception as e:
            logger.error(f"Error clearing index: {str(e)}", exc_info=True)
            raise