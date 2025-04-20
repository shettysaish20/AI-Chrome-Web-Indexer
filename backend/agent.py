"""
agent.py - Main orchestrator for the Chrome Web Indexer
Coordinates between perception, memory, decision, and action components
"""

import logging
import time
from typing import List, Dict, Any

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class SearchResult:
    """Represents a search result with content and metadata"""
    def __init__(self, url: str, title: str, content: str, score: float, chunk_id: str = None):
        self.url = url
        self.title = title
        self.content = content
        self.score = score
        self.chunk_id = chunk_id

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization"""
        return {
            "url": self.url,
            "title": self.title,
            "content": self.content,
            "score": self.score,
            "chunk_id": self.chunk_id
        }

class Agent:
    """
    Agent class that coordinates between perception, memory, decision, and action components
    """
    def __init__(self, memory):
        """Initialize the agent with a memory manager"""
        self.memory = memory
        logger.info("Agent initialized")

    def process_page(self, url: str, title: str, content: str) -> Dict[str, Any]:
        """
        Process a web page through the agent pipeline
        
        Args:
            url: The URL of the web page
            title: The title of the web page
            content: The content of the web page
            
        Returns:
            Dictionary with processing status and result
        """
        from perception import extract_perception
        
        try:
            # 1. Perception: Extract and process the page content
            perception_result = extract_perception(content, url, title)
            
            if perception_result.is_confidential:
                logger.info(f"Skipping confidential page: {url}")
                return {
                    "status": "skipped",
                    "message": "Confidential page not indexed"
                }
                
            # 2. Memory: Add to the vector index
            doc_id = self.memory.add_document(
                url=url,
                title=title,
                content=perception_result.content,
                chunks=perception_result.chunks
            )
            
            return {
                "status": "success",
                "message": "Page processed and indexed",
                "doc_id": doc_id
            }
            
        except Exception as e:
            logger.error(f"Error processing page {url}: {str(e)}", exc_info=True)
            return {
                "status": "error",
                "message": str(e)
            }

    def process_search(self, query: str) -> List[Dict[str, Any]]:
        """
        Process a search query through the agent pipeline
        
        Args:
            query: The search query
            
        Returns:
            List of search results
        """
        from decision import decide_action
        from action import perform_action
        
        try:
            # 1. Memory: Search the vector index
            memory_results = self.memory.search(query, top_k=5)
            
            # 2. Decision: Determine the most relevant results and actions
            action_plan = decide_action(query, memory_results)
            
            # 3. Action: Prepare the results for display/highlighting
            final_results = perform_action(action_plan)
            
            # Convert results to dictionary format for JSON serialization
            return [result.to_dict() for result in final_results]
            
        except Exception as e:
            logger.error(f"Error processing search query '{query}': {str(e)}", exc_info=True)
            return []