"""
decision.py - Decision making component for the web indexer
Processes search results and determines the most relevant content
"""

import logging
from typing import List, Dict, Any

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class ActionPlan:
    """Represents an action plan with search results"""
    def __init__(self, query: str, results: List[Dict[str, Any]]):
        self.query = query
        self.results = results
        self.highlight_terms = extract_highlight_terms(query)

def extract_highlight_terms(query: str) -> List[str]:
    """
    Extract terms from the query to highlight in search results
    
    Args:
        query: Search query
        
    Returns:
        List of terms to highlight
    """
    # Simple tokenization - split by spaces and remove punctuation
    terms = []
    for term in query.lower().split():
        # Remove punctuation from beginning and end of term
        term = term.strip(",.?!:;'\"-()[]{}")
        if term and len(term) > 2:  # Only include terms longer than 2 characters
            terms.append(term)
            
    return terms

def decide_action(query: str, search_results: List[Dict[str, Any]]) -> ActionPlan:
    """
    Process search results and create an action plan
    
    Args:
        query: Search query
        search_results: Results from the memory search
        
    Returns:
        ActionPlan object with processed results
    """
    try:
        logger.info(f"Creating action plan for query: '{query}' with {len(search_results)} results")
        
        # Sort results by score in descending order (highest relevance first)
        sorted_results = sorted(search_results, key=lambda x: x.get("score", 0), reverse=True)
        
        logger.info(f"Action plan created with {len(sorted_results)} filtered results")
        return ActionPlan(query=query, results=sorted_results)
        
    except Exception as e:
        logger.error(f"Error creating action plan: {str(e)}", exc_info=True)
        # Return an empty action plan on error
        return ActionPlan(query=query, results=[])