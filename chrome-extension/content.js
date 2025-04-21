/**
 * content.js - Content script for the Chrome Web Indexer extension
 * Extracts page content and handles highlighting
 */

// State variable to track if the content script is ready
let isContentScriptReady = false;

// Track already highlighted elements to avoid duplicates
const highlightedTexts = new Set();

// Function to extract page content
function extractPageContent() {
  // Simple extraction: get the text content of the entire page
  return document.body ? document.body.innerText : '';
}

// Advanced function to find text in page, even partial matches
function findTextInPage(searchText, fuzzyMatch = true) {
  if (!searchText || typeof searchText !== 'string' || searchText.length < 3) {
    console.log('[WebIndexer] Invalid search text:', searchText);
    return [];
  }
  
  searchText = searchText.trim().toLowerCase();
  console.log(`[WebIndexer] Searching for "${searchText}" (${searchText.length} chars)`);
  
  // Get all text nodes
  const textNodes = [];
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  
  while (walk.nextNode()) {
    const node = walk.currentNode;
    // Only consider nodes with meaningful content
    if (node.textContent && node.textContent.trim().length > 3 && 
        node.parentElement && 
        !['SCRIPT', 'STYLE', 'NOSCRIPT', 'META'].includes(node.parentElement.tagName)) {
      textNodes.push(node);
    }
  }
  
  console.log(`[WebIndexer] Found ${textNodes.length} text nodes to search`);
  
  const matches = [];
  const searchTerms = fuzzyMatch ? 
    searchText.split(/\s+/).filter(term => term.length > 3) : 
    [searchText];
  
  if (searchTerms.length === 0) {
    searchTerms.push(searchText); // Use full search text if no good terms were found
  }
  
  console.log(`[WebIndexer] Search terms: ${JSON.stringify(searchTerms)}`);
  
  // First try exact matches
  for (const node of textNodes) {
    const content = node.textContent;
    const lowerContent = content.toLowerCase();
    
    if (lowerContent.includes(searchText)) {
      // Exact match - highest priority
      matches.push({
        node,
        text: content.substring(lowerContent.indexOf(searchText), 
                              lowerContent.indexOf(searchText) + searchText.length),
        index: lowerContent.indexOf(searchText),
        priority: 1, // Highest priority
        score: searchText.length * 3 // Boost exact matches
      });
    } else {
      // Look for partial matches
      for (const term of searchTerms) {
        if (term.length < 4) continue;
        
        if (lowerContent.includes(term)) {
          matches.push({
            node,
            text: content.substring(lowerContent.indexOf(term), 
                                  lowerContent.indexOf(term) + term.length),
            index: lowerContent.indexOf(term),
            priority: 2, // Medium priority
            score: term.length
          });
        }
      }
    }
  }
  
  // If no matches with first approach, try sentence-level matching
  if (matches.length === 0 && fuzzyMatch && searchText.length > 15) {
    console.log('[WebIndexer] Trying sentence-level matching');
    
    // Split search text into sentences or chunks
    const searchChunks = searchText
      .split(/[.!?]+/)
      .map(s => s.trim())
      .filter(s => s.length > 15);
    
    for (const node of textNodes) {
      const content = node.textContent;
      const lowerContent = content.toLowerCase();
      
      // Try each search chunk
      for (const chunk of searchChunks) {
        if (chunk.length < 15) continue;
        
        // Create words from the chunk and look for consecutive word matches
        const chunkWords = chunk.toLowerCase().split(/\s+/);
        if (chunkWords.length < 3) continue;
        
        // Try to find 3+ consecutive words in the content
        for (let i = 0; i <= chunkWords.length - 3; i++) {
          const phraseToFind = chunkWords.slice(i, i + 3).join(' ');
          if (phraseToFind.length < 12) continue;
          
          const phraseIndex = lowerContent.indexOf(phraseToFind);
          if (phraseIndex >= 0) {
            matches.push({
              node,
              text: content.substring(phraseIndex, phraseIndex + phraseToFind.length),
              index: phraseIndex,
              priority: 3, // Lower priority
              score: phraseToFind.length
            });
            break; // Move to next node once we find a match
          }
        }
      }
    }
  }
  
  // Final fallback: try character-level fuzzy matching for important sections
  if (matches.length === 0 && fuzzyMatch && searchText.length > 20) {
    console.log('[WebIndexer] Trying character-level fuzzy matching');
    
    const minMatchLength = Math.min(15, Math.floor(searchText.length * 0.3));
    
    // Extract significant substrings at different positions of the search text
    const substrings = [
      searchText.substring(0, 20),                             // Start
      searchText.substring(Math.floor(searchText.length / 2) - 10, Math.floor(searchText.length / 2) + 10),  // Middle
      searchText.substring(Math.max(0, searchText.length - 20)), // End
    ].filter(s => s.length >= minMatchLength);
    
    for (const node of textNodes) {
      const content = node.textContent;
      const lowerContent = content.toLowerCase();
      
      // Try each significant substring
      for (const substring of substrings) {
        const lowerSubstring = substring.toLowerCase();
        
        for (let i = 0; i <= lowerSubstring.length - minMatchLength; i += 5) {
          const chunk = lowerSubstring.substring(i, i + minMatchLength);
          if (chunk.length < minMatchLength) continue;
          
          const index = lowerContent.indexOf(chunk);
          if (index >= 0) {
            matches.push({
              node,
              text: content.substring(index, index + chunk.length),
              index: index,
              priority: 4, // Lowest priority
              score: chunk.length
            });
            break; // Move to next substring once we find a match
          }
        }
      }
    }
  }
  
  console.log(`[WebIndexer] Found ${matches.length} matches`);
  
  // Sort matches by priority (higher first) and then by score (longer matches first)
  matches.sort((a, b) => {
    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }
    return b.score - a.score;
  });
  
  // Filter out very low scoring matches if we have enough good ones
  if (matches.length > 5) {
    return matches.slice(0, 5);
  }
  
  return matches;
}

// Function to highlight text on the page with improved robustness
function highlightTextOnPage(positions) {
  try {
    console.log('[WebIndexer] Highlight request received:', positions);
    
    if (!positions || !positions.length) {
      console.log('[WebIndexer] No valid positions to highlight');
      return { success: false, reason: 'no_positions' };
    }
    
    // Clear existing highlights first
    clearHighlights();
    
    let foundAny = false;
    let firstHighlight = null;
    let matchesFound = 0;
    
    // Process each position/term
    for (const position of positions) {
      const term = position.term;
      
      if (!term || typeof term !== 'string' || term.length < 3) {
        console.log(`[WebIndexer] Skipping invalid term: ${term}`);
        continue;
      }
      
      console.log(`[WebIndexer] Processing highlight term: "${term}"`);
      
      // Find matches for this term
      const matches = findTextInPage(term, true);
      
      if (matches.length > 0) {
        foundAny = true;
        highlightedTexts.add(term);
        matchesFound += matches.length;
        
        // Limit to 3 highlights per term to avoid excessive highlighting
        const limitedMatches = matches.slice(0, 3);
        
        for (const match of limitedMatches) {
          const highlight = highlightNode(match.node, match.text, match.index);
          if (!firstHighlight && highlight) {
            firstHighlight = highlight;
          }
        }
      } else {
        console.log(`[WebIndexer] No matches found for: "${term}"`);
      }
    }
    
    // Scroll to the first highlighted element
    if (firstHighlight) {
      console.log('[WebIndexer] Scrolling to first highlighted element');
      setTimeout(() => {
        firstHighlight.scrollIntoView({
          behavior: 'smooth',
          block: 'center'
        });
        
        // Add a temporary outline to make it more noticeable
        firstHighlight.style.outline = '3px solid #FFA500';
        setTimeout(() => {
          firstHighlight.style.outline = 'none';
        }, 3000);
      }, 500);
    }
    
    return { 
      success: foundAny, 
      matchesFound,
      reason: foundAny ? 'success' : 'no_matches_found' 
    };
  } catch (error) {
    console.error('[WebIndexer] Error highlighting text:', error);
    return { success: false, reason: 'error', error: error.message };
  }
}

// Helper to highlight a specific node at specific position
function highlightNode(node, text, startIndex) {
  try {
    if (!node || startIndex < 0 || !text) {
      return null;
    }
    
    // Create a range to highlight the text
    const range = document.createRange();
    range.setStart(node, startIndex);
    range.setEnd(node, startIndex + text.length);
    
    // Create highlight element
    const highlightSpan = document.createElement('span');
    highlightSpan.className = 'web-indexer-highlight';
    highlightSpan.style.backgroundColor = '#FFFF88';
    highlightSpan.style.color = '#000000';
    highlightSpan.style.padding = '2px';
    highlightSpan.style.borderRadius = '2px';
    highlightSpan.style.boxShadow = '0 0 0 1px rgba(0, 0, 0, 0.2)';
    highlightSpan.style.display = 'inline';
    highlightSpan.style.transition = 'all 0.3s ease-in-out';
    
    try {
      // Wrap the text in our highlight span
      range.surroundContents(highlightSpan);
      console.log(`[WebIndexer] Highlighted text: "${text}"`);
      
      // Add pulse animation
      setTimeout(() => {
        highlightSpan.style.backgroundColor = '#FFA500';
        setTimeout(() => {
          highlightSpan.style.backgroundColor = '#FFFF88';
        }, 300);
      }, 100);
      
      return highlightSpan;
    } catch (e) {
      console.error(`[WebIndexer] Error highlighting node: ${e.message}`);
      
      // Alternative approach: replace the entire text node
      try {
        const parentElement = node.parentElement;
        if (parentElement) {
          const nodeContent = node.textContent;
          const beforeText = nodeContent.substring(0, startIndex);
          const highlightText = nodeContent.substring(startIndex, startIndex + text.length);
          const afterText = nodeContent.substring(startIndex + text.length);
          
          const beforeNode = document.createTextNode(beforeText);
          const afterNode = document.createTextNode(afterText);
          
          highlightSpan.textContent = highlightText;
          
          // Replace the original node with our three new nodes
          parentElement.replaceChild(afterNode, node);
          parentElement.insertBefore(highlightSpan, afterNode);
          parentElement.insertBefore(beforeNode, highlightSpan);
          
          return highlightSpan;
        }
      } catch (fallbackError) {
        console.error('[WebIndexer] Fallback highlighting failed:', fallbackError);
      }
      
      return null;
    }
  } catch (error) {
    console.error('[WebIndexer] Error in highlightNode:', error);
    return null;
  }
}

// Function to clear all highlights
function clearHighlights() {
  try {
    const highlights = document.querySelectorAll('.web-indexer-highlight');
    console.log(`[WebIndexer] Clearing ${highlights.length} highlights`);
    
    highlights.forEach(element => {
      // Replace the highlight element with its text content
      const textNode = document.createTextNode(element.textContent);
      element.parentNode.replaceChild(textNode, element);
    });
    
    highlightedTexts.clear();
  } catch (error) {
    console.error('[WebIndexer] Error clearing highlights:', error);
  }
}

// Set up message listener for various actions
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Handle extract content action
  if (message.action === 'extractContent') {
    const content = extractPageContent();
    sendResponse({
      content: content
    });
    return true; // Indicates we'll respond asynchronously
  }
  
  // Handle highlight action
  if (message.action === 'highlight') {
    console.log('[WebIndexer] Highlight action received:', message);
    const result = highlightTextOnPage(message.positions);
    sendResponse(result);
    return true; // Indicates we'll respond asynchronously
  }
  
  // Handle checking if content script is ready
  if (message.action === 'isContentScriptReady') {
    sendResponse({ ready: isContentScriptReady });
    return true;
  }
});

// Attempt to read highlight data from session storage immediately
chrome.storage.session.get(['highlightData'], (result) => {
  if (result.highlightData) {
    console.log('[WebIndexer] Found highlight data in session storage');
    setTimeout(() => {
      try {
        const data = result.highlightData;
        const positions = [];
        
        // Use snippet first if available
        if (data.snippet && data.snippet.length > 15) {
          positions.push({ term: data.snippet });
        }
        
        // Use content as fallback
        if (positions.length === 0 && data.content && data.content.length > 15) {
          // Split content into shorter chunks for better matching
          const contentChunks = data.content.split(/[.!?]+/).filter(s => s.trim().length > 15);
          if (contentChunks.length > 0) {
            // Sort chunks by length and pick the most distinctive (medium length)
            contentChunks.sort((a, b) => {
              const aScore = Math.abs(a.length - 40);
              const bScore = Math.abs(b.length - 40);
              return aScore - bScore;
            });
            positions.push({ term: contentChunks[0].trim() });
          } else {
            positions.push({ term: data.content.substring(0, Math.min(80, data.content.length)) });
          }
        }
        
        if (positions.length > 0) {
          console.log('[WebIndexer] Auto-highlighting from session storage');
          highlightTextOnPage(positions);
          
          // Clear the session storage after use
          chrome.storage.session.remove('highlightData');
        }
      } catch (error) {
        console.error('[WebIndexer] Error processing session storage highlight data:', error);
      }
    }, 1500); // Wait for page to load
  }
});

// Notify that the content script is ready to receive messages
isContentScriptReady = true;
chrome.runtime.sendMessage({ action: 'contentScriptReady' });

// Log that content script was loaded
console.log('[WebIndexer] Content script loaded successfully');