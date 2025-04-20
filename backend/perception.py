"""
perception.py - Extract and process web page content
Determines if pages are confidential and extracts meaningful content
"""

import logging
import re
from pathlib import Path
from dataclasses import dataclass
from typing import List, Optional
from urllib.parse import urlparse

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# List of domains to skip (confidential sites)
CONFIDENTIAL_DOMAINS = [
    'mail.google.com',        # Gmail
    'web.whatsapp.com',       # WhatsApp Web
    'drive.google.com',       # Google Drive
    'docs.google.com',        # Google Docs
    'sheets.google.com',      # Google Sheets
    'calendar.google.com',    # Google Calendar
    'meet.google.com',        # Google Meet
    'outlook.live.com',       # Outlook
    'outlook.office.com',     # Office 365
    'web.telegram.org',       # Telegram
    'app.slack.com',          # Slack
    'discord.com',            # Discord
    'teams.microsoft.com',    # Microsoft Teams
    'banking',                # Generic banking
    'account',                # Generic accounts
    'signin',                 # Sign in pages
    'login',                  # Login pages
    'paypal.com',             # PayPal
    'myaccount',              # Account pages
    'checkout',               # Checkout pages
]

@dataclass
class PerceptionResult:
    """Result of the perception process"""
    content: str                  # Processed content
    url: str                      # URL of the page
    title: str                    # Page title
    chunks: List[str]             # Content chunks for embedding
    is_confidential: bool = False # Whether the page is confidential

def is_confidential_url(url: str) -> bool:
    """
    Check if a URL should be considered confidential
    
    Args:
        url: The URL to check
        
    Returns:
        True if the URL is confidential, False otherwise
    """
    try:
        parsed_url = urlparse(url)
        hostname = parsed_url.netloc.lower()
        path = parsed_url.path.lower()
        
        # Check if domain or path contains any confidential keywords
        return any(domain in hostname or domain in path for domain in CONFIDENTIAL_DOMAINS)
    except Exception as e:
        logger.error(f"Error parsing URL {url}: {str(e)}")
        return True  # If we can't parse the URL, consider it confidential

def clean_content(content: str) -> str:
    """
    Clean the content by removing unnecessary whitespace, etc.
    
    Args:
        content: The content to clean
        
    Returns:
        Cleaned content
    """
    if not content:
        return ""
        
    # Remove excessive whitespace
    content = re.sub(r'\s+', ' ', content)
    
    # Remove common navigation-related text
    content = re.sub(r'(menu|navigation|search|skip to content)', ' ', content, flags=re.IGNORECASE)
    
    return content.strip()

def chunk_text(text: str, max_chunk_size: int = 1000, overlap: int = 200) -> List[str]:
    """
    Split text into chunks for embedding
    
    Args:
        text: The text to chunk
        max_chunk_size: Maximum size of each chunk
        overlap: Overlap between chunks
        
    Returns:
        List of text chunks
    """
    if not text:
        return []
        
    chunks = []
    sentences = re.split(r'(?<=[.!?])\s+', text)
    
    current_chunk = ""
    
    for sentence in sentences:
        # If adding this sentence would exceed max length, store the chunk and start a new one
        if len(current_chunk) + len(sentence) > max_chunk_size and current_chunk:
            chunks.append(current_chunk)
            
            # The new chunk starts with the overlap from the previous chunk
            words = current_chunk.split()
            overlap_text = " ".join(words[-overlap:]) if len(words) > overlap else current_chunk
            current_chunk = overlap_text + " " + sentence
        else:
            # Add the sentence to the current chunk
            current_chunk += (" " if current_chunk else "") + sentence
    
    # Add the last chunk if it's not empty
    if current_chunk:
        chunks.append(current_chunk)
    
    return chunks

def extract_perception(content: str, url: str, title: str) -> PerceptionResult:
    """
    Extract and process content from a web page
    
    Args:
        content: The HTML content of the page
        url: The URL of the page
        title: The title of the page
        
    Returns:
        PerceptionResult with processed content and metadata
    """
    try:
        # Check if the URL is confidential
        confidential = is_confidential_url(url)
        if confidential:
            logger.info(f"Skipping confidential page: {url}")
            return PerceptionResult(
                content="",
                url=url,
                title=title,
                chunks=[],
                is_confidential=True
            )
        
        # Clean and process the content
        processed_content = clean_content(content)
        
        # Create chunks for embedding
        chunks = chunk_text(processed_content)
        
        logger.info(f"Processed page {url}: {len(processed_content)} chars, {len(chunks)} chunks")
        
        return PerceptionResult(
            content=processed_content,
            url=url,
            title=title,
            chunks=chunks,
            is_confidential=False
        )
        
    except Exception as e:
        logger.error(f"Error in perception for {url}: {str(e)}", exc_info=True)
        return PerceptionResult(
            content="",
            url=url,
            title=title,
            chunks=[],
            is_confidential=True  # Mark as confidential on error to be safe
        )