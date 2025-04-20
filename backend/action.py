"""
action.py - Action component for the web indexer
Prepares search results for highlighting and display
"""

import logging
from typing import List, Dict, Any
import re
from decision import ActionPlan

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class SearchResult:
    """
    Represents a search result with content and metadata
    """
    def __init__(self, url: str, title: str, content: str, score: float, chunk_id: str = None):
        self.url = url
        self.title = title
        self.content = content
        self.score = score
        self.chunk_id = chunk_id
        self.highlight_positions = []  # Positions for highlighting
        self.snippet = None  # Will be populated later
        
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization"""
        return {
            "url": self.url,
            "title": self.title,
            "content": self.content,
            "score": self.score,
            "chunk_id": self.chunk_id,
            "highlight_positions": self.highlight_positions,
            "snippet": self.snippet
        }

def find_highlight_positions(content: str, terms: List[str]) -> List[Dict[str, int]]:
    """
    Find positions for highlighting terms in content
    
    Args:
        content: Content to search in
        terms: Terms to highlight
        
    Returns:
        List of dictionaries with start and end positions
    """
    positions = []
    content_lower = content.lower()
    
    for term in terms:
        term_lower = term.lower()
        start_pos = 0
        
        while start_pos < len(content_lower):
            pos = content_lower.find(term_lower, start_pos)
            if pos == -1:
                break
                
            positions.append({
                "start": pos,
                "end": pos + len(term),
                "term": term
            })
            
            start_pos = pos + len(term)
    
    # Sort positions by start position
    positions.sort(key=lambda x: x["start"])
    return positions

def perform_action(action_plan: ActionPlan) -> List[SearchResult]:
    """
    Execute the action plan and prepare search results
    
    Args:
        action_plan: Action plan with search results and highlight terms
        
    Returns:
        List of processed SearchResult objects
    """
    try:
        logger.info(f"Performing action for query: '{action_plan.query}'")
        results = []
        
        for result_dict in action_plan.results:
            # Create a SearchResult object from the dictionary
            search_result = SearchResult(
                url=result_dict["url"],
                title=result_dict["title"],
                content=result_dict["content"],
                score=result_dict["score"],
                chunk_id=result_dict.get("chunk_id")
            )
            
            # Find positions for highlighting
            highlight_positions = find_highlight_positions(
                search_result.content, 
                action_plan.highlight_terms
            )
            search_result.highlight_positions = highlight_positions
            
            # Add a snippet based on the first highlight position
            if highlight_positions:
                first_pos = highlight_positions[0]["start"]
                start_snippet = max(0, first_pos - 100)
                end_snippet = min(len(search_result.content), first_pos + 150)
                search_result.snippet = search_result.content[start_snippet:end_snippet]
                
                # Add ellipsis if needed
                if start_snippet > 0:
                    search_result.snippet = "..." + search_result.snippet
                if end_snippet < len(search_result.content):
                    search_result.snippet = search_result.snippet + "..."
            else:
                # If no highlights, use the first part of the content
                search_result.snippet = search_result.content[:200]
                if len(search_result.content) > 200:
                    search_result.snippet += "..."
                    
            results.append(search_result)
        
        logger.info(f"Action complete with {len(results)} processed results")
        return results
        
    except Exception as e:
        logger.error(f"Error performing action: {str(e)}", exc_info=True)
        return []