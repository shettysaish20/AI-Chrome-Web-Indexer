"""
chat.py - Chat functionality for the Chrome Web Indexer
Integrates with Gemini AI for chatbot capabilities
"""

import logging
import os
import json
from typing import List, Dict, Any, Optional
from dotenv import load_dotenv
from google import genai

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Load environment variables
load_dotenv()

# Initialize the Gemini client
try:
    genai_api_key = os.getenv("GEMINI_API_KEY")
    if not genai_api_key:
        logger.warning("GEMINI_API_KEY not found in environment variables")
        
    client = genai.Client(api_key=genai_api_key)
    GEMINI_MODEL = "gemini-2.0-flash"
    logger.info(f"Gemini client initialized with model {GEMINI_MODEL}")
except Exception as e:
    logger.error(f"Failed to initialize Gemini client: {str(e)}", exc_info=True)
    client = None

class ChatResponse:
    """Container for chat responses with sources"""
    def __init__(self, text: str, sources: List[Dict[str, Any]]):
        self.text = text
        self.sources = sources

def generate_chat_response(query: str, context_results: List[Dict[str, Any]]) -> ChatResponse:
    """
    Generate a response to a chat query using Gemini and indexed content
    
    Args:
        query: The user's query
        context_results: Search results to use as context
        
    Returns:
        ChatResponse object with response text and sources
    """
    try:
        if not client:
            logger.error("Cannot generate chat response: Gemini client not initialized")
            return ChatResponse(
                text="I'm sorry, but I can't generate a response right now due to a configuration issue. Please check the GEMINI_API_KEY environment variable.",
                sources=[]
            )
        
        # Build the context from search results
        context_text = ""
        used_sources = []
        
        for idx, result in enumerate(context_results[:5]):  # Limit to top 5 results
            source_text = result.get("content", "").strip()
            if source_text:
                source_info = {
                    "url": result.get("url", ""),
                    "title": result.get("title", "Unknown"),
                    "chunk_id": result.get("chunk_id", ""),
                    "snippet": source_text[:200] + "..." if len(source_text) > 200 else source_text
                }
                used_sources.append(source_info)
                context_text += f"[Source {idx+1}] From {source_info['title']}:\n{source_text}\n\n"
        
        if not context_text:
            logger.warning("No context available for query")
            return ChatResponse(
                text="I don't have enough information in my index to answer your question. Try browsing more pages related to your query or try a different question.",
                sources=[]
            )
        
        # Create the prompt for Gemini - make it shorter to avoid timeouts
        prompt = f"""You are an assistant that answers questions about the user's browsing history based on the indexed content below.
Be concise and focused. Only answer based on the information provided.

Here's the indexed content:

{context_text}

User Query: {query}

Keep your response under 300 words. At the end, mention your sources.
"""

        # Generate the response with Gemini
        logger.info(f"Generating response with Gemini for query: '{query}'")
        response = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=prompt,
            # generation_config={
            #     "max_output_tokens": 512,  # Limit output size
            #     "temperature": 0.2,  # More focused responses
            #     "top_p": 0.8,
            #     "top_k": 40
            # }
        )
        
        response_text = response.text.strip()
        logger.info(f"Generated response: {len(response_text)} chars")
        
        return ChatResponse(
            text=response_text,
            sources=used_sources
        )
        
    except Exception as e:
        logger.error(f"Error generating chat response: {str(e)}", exc_info=True)
        return ChatResponse(
            text=f"I encountered an error while trying to generate a response: {str(e)}",
            sources=[]
        )