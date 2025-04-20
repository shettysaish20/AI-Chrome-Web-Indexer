/**
 * content.js - Content script for the Chrome Web Indexer extension
 * Extracts page content and handles highlighting
 */

// State variable to track if the content script is ready
let isContentScriptReady = false;

// Function to extract page content
function extractPageContent() {
  // Simple extraction: get the text content of the entire page
  return document.body ? document.body.innerText : '';
}

// Function to highlight text on the page
function highlightTextOnPage(positions) {
  try {
    if (!positions || !positions.length) {
      return;
    }
    
    // Create a range object for selection
    const range = document.createRange();
    const selection = window.getSelection();
    
    // Clear any existing selections
    selection.removeAllRanges();
    
    // Get all text nodes in the document
    const textNodes = [];
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    
    while (walk.nextNode()) {
      textNodes.push(walk.currentNode);
    }
    
    // For each term to highlight, find it and scroll to the first occurrence
    let foundAny = false;
    let firstFound = null;
    
    for (const position of positions) {
      const term = position.term.toLowerCase();
      
      if (!term) continue;
      
      // Search through text nodes for matches
      for (const node of textNodes) {
        const content = node.textContent;
        const lowerContent = content.toLowerCase();
        const index = lowerContent.indexOf(term);
        
        if (index >= 0) {
          foundAny = true;
          
          // Set range to the found term
          range.setStart(node, index);
          range.setEnd(node, index + term.length);
          
          // Add range to selection
          selection.addRange(range);
          
          // Save the first found element for scrolling
          if (!firstFound) {
            firstFound = node;
          }
          
          // Remove this range and continue (to allow multiple selections)
          selection.removeAllRanges();
          
          // Apply highlight styles
          const highlightSpan = document.createElement('span');
          highlightSpan.className = 'web-indexer-highlight';
          highlightSpan.style.backgroundColor = 'yellow';
          highlightSpan.style.color = 'black';
          highlightSpan.style.padding = '2px';
          
          // Use the range to highlight
          range.surroundContents(highlightSpan);
          
          // We've modified the DOM, so the text nodes array is now invalid
          // We need to get fresh text nodes for the next search
          break;
        }
      }
    }
    
    // Scroll to the first highlighted element
    if (firstFound) {
      firstFound.parentElement.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      });
    }
    
    return foundAny;
  } catch (error) {
    console.error('Error highlighting text:', error);
    return false;
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
    const result = highlightTextOnPage(message.positions);
    sendResponse({ success: result });
    return true; // Indicates we'll respond asynchronously
  }
});

// Notify that the content script is ready to receive messages
isContentScriptReady = true;
chrome.runtime.sendMessage({ action: 'contentScriptReady' });

// Log that content script was loaded
console.log('[WebIndexer] Content script loaded successfully');