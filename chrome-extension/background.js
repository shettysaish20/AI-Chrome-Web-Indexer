/**
 * Background script for the Chrome Web Indexer extension
 * Handles communication between popup, content scripts, and backend
 */

// Constants for the app
const BACKEND_URL = 'http://localhost:5001';
const DEBUG = true;

// Helper function to log messages (only in debug mode)
function log(message) {
  if (DEBUG) {
    console.log(`[WebIndexer] ${message}`);
  }
}

// Store tab IDs where content has been indexed
const indexedTabs = {};

// Track active chat sessions
const activeSessions = {};

// Handle messages from popup and content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  log(`Received message: ${message.action}`);

  // When content script reports it's ready
  if (message.action === 'contentScriptReady') {
    const tabId = sender.tab?.id;
    if (tabId) {
      log(`Content script ready in tab ${tabId}`);
    }
    return false; // No response needed
  }

  // Handle highlight source action from popup
  if (message.action === 'highlightSource') {
    try {
      const { tabId, source } = message;
      
      if (!tabId || !source || !source.url) {
        log('Invalid highlight source parameters');
        sendResponse({ success: false, error: 'Invalid parameters' });
        return false;
      }
      
      log(`Highlighting source in tab ${tabId}: ${source.url}`);
      
      // Extract terms from the source to highlight
      let positions = [];
      
      // Use snippet first if available
      if (source.snippet && source.snippet.length > 15) {
        positions.push({ term: source.snippet });
      }
      // Also try content if available
      if (source.content && source.content.length > 15) {
        const contentTerms = extractHighlightTermsFromContent(source.content);
        if (contentTerms.length > 0) {
          positions.push(...contentTerms.map(term => ({ term })));
        }
      }
      
      // If neither worked, create a fallback approach
      if (positions.length === 0) {
        log('No good highlight terms found, using fallback');
        // Try to use at least something from the source
        positions.push({ 
          term: (source.snippet || source.content || '').substring(0, 80) 
        });
      }
      
      // Send highlight message to the content script
      chrome.tabs.sendMessage(
        tabId,
        {
          action: 'highlight',
          positions: positions
        },
        (response) => {
          if (chrome.runtime.lastError) {
            log(`Error sending highlight message: ${chrome.runtime.lastError.message}`);
            sendResponse({ success: false, error: chrome.runtime.lastError.message });
            return;
          }
          sendResponse(response || { success: false, error: 'No response from content script' });
        }
      );
      
      return true; // Asynchronous response
    } catch (error) {
      log(`Error in highlightSource: ${error.message}`);
      sendResponse({ success: false, error: error.message });
      return false;
    }
  }

  // Index the current page
  if (message.action === 'indexPage') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs[0];
      if (!activeTab) {
        sendResponse({ success: false, error: 'No active tab found' });
        return;
      }

      // Request content from the tab
      chrome.tabs.sendMessage(
        activeTab.id,
        { action: 'extractContent' },
        (response) => {
          if (chrome.runtime.lastError) {
            sendResponse({
              success: false,
              error: 'Content script not accessible: ' + chrome.runtime.lastError.message
            });
            return;
          }

          if (!response || !response.content) {
            sendResponse({ success: false, error: 'No content received from page' });
            return;
          }

          // Prepare data to send to backend
          const pageData = {
            url: activeTab.url,
            title: activeTab.title || 'Untitled',
            content: response.content,
            timestamp: new Date().toISOString()
          };

          // Send to backend for indexing
          fetch(`${BACKEND_URL}/index`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(pageData)
          })
            .then(response => response.json())
            .then(data => {
              if (data.success) {
                indexedTabs[activeTab.id] = true;
                sendResponse({ success: true, message: 'Page indexed successfully' });
              } else {
                sendResponse({ success: false, error: data.error || 'Unknown error during indexing' });
              }
            })
            .catch(error => {
              sendResponse({
                success: false,
                error: `Error communicating with backend: ${error.message}`
              });
            });
        }
      );
    });

    return true; // Asynchronous response
  }

  // Chat with the AI
  if (message.action === 'chat') {
    const { query, sessionId } = message;
    
    // Send chat message to backend
    fetch(`${BACKEND_URL}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, session_id: sessionId })
    })
      .then(response => response.json())
      .then(data => {
        if (sessionId) {
          activeSessions[sessionId] = true;
        }
        sendResponse(data);
      })
      .catch(error => {
        sendResponse({
          success: false,
          error: `Error communicating with backend: ${error.message}`
        });
      });

    return true; // Asynchronous response
  }

  // Handle highlight text command from popup
  if (message.action === 'highlightText') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs || !tabs[0]) {
        sendResponse({ success: false, error: 'No active tab' });
        return;
      }

      chrome.tabs.sendMessage(
        tabs[0].id,
        {
          action: 'highlight',
          positions: message.positions || []
        },
        (response) => {
          if (chrome.runtime.lastError) {
            log(`Error sending highlight message: ${chrome.runtime.lastError.message}`);
            sendResponse({ success: false, error: chrome.runtime.lastError.message });
            return;
          }
          sendResponse(response || { success: false, error: 'No response from content script' });
        }
      );
    });

    return true; // Asynchronous response
  }
  
  // Handle navigate to source with highlighting
  if (message.action === 'navigateToSource') {
    try {
      const { url, snippet, sourceName } = message;
      
      if (!url) {
        sendResponse({ success: false, error: 'No URL provided' });
        return false;
      }
      
      log(`Navigating to source: ${url} with snippet: ${snippet && snippet.substring(0, 30)}...`);
      
      // Store highlight data in session storage for the content script to use
      const highlightData = {
        snippet: snippet || '',
        url: url,
        timestamp: Date.now(),
        sourceName: sourceName || 'Unknown Source'
      };
      
      // Save to session storage
      chrome.storage.session.set({ highlightData }, () => {
        if (chrome.runtime.lastError) {
          log(`Error saving to session storage: ${chrome.runtime.lastError.message}`);
        } else {
          log('Saved highlight data to session storage');
          
          // Create a new tab and navigate to the source
          chrome.tabs.create({ url }, (tab) => {
            sendResponse({ success: true, tabId: tab.id });
          });
        }
      });
      
      return true; // Asynchronous response
    } catch (error) {
      log(`Error in navigateToSource: ${error.message}`);
      sendResponse({ success: false, error: error.message });
      return false;
    }
  }
  
  // Check if content script is ready
  if (message.action === 'isContentScriptReady') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs || !tabs[0]) {
        sendResponse({ ready: false, error: 'No active tab' });
        return;
      }
      
      chrome.tabs.sendMessage(
        tabs[0].id,
        { action: 'isContentScriptReady' },
        (response) => {
          if (chrome.runtime.lastError) {
            sendResponse({ ready: false, error: chrome.runtime.lastError.message });
            return;
          }
          sendResponse(response || { ready: false });
        }
      );
    });
    
    return true; // Asynchronous response
  }

  return false; // Synchronous response or no response needed
});

// Listen for tab updates
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // If the tab has completed loading and has been indexed before
  if (changeInfo.status === 'complete' && indexedTabs[tabId]) {
    log(`Tab ${tabId} reloaded, checking for pending highlights`);
    
    // Check if there's pending highlight data for this URL
    chrome.storage.session.get(['highlightData'], (result) => {
      if (result.highlightData && result.highlightData.url === tab.url) {
        log('Found pending highlight data for this URL');
      }
    });
  }
});

// Helper function to extract highlight terms from content
function extractHighlightTermsFromContent(content) {
  if (!content || typeof content !== 'string') return [];
  
  content = content.trim().replace(/\s+/g, ' ');
  if (content.length < 15) return [];
  
  const result = [];
  
  // Strategy 1: Look for sentences (30-80 chars) - these work best for highlighting
  const sentences = content.split(/[.!?]+/).map(s => s.trim())
    .filter(s => s.length >= 30 && s.length <= 80);
    
  if (sentences.length > 0) {
    // Use top 2 sentences for highlighting
    result.push(...sentences.slice(0, 2));
    return result;
  }
  
  // Strategy 2: Look for phrases (consecutive words) 
  const words = content.trim().split(/\s+/);
  for (let i = 0; i < words.length - 5 && result.length < 2; i += 5) {
    const phrase = words.slice(i, i + 5).join(' ');
    if (phrase.length >= 20 && phrase.length <= 60) {
      result.push(phrase);
    }
  }
  
  // Strategy 3: If nothing else worked, take a substring of content
  if (result.length === 0 && content.length > 20) {
    result.push(content.substring(0, Math.min(80, content.length)));
  }
  
  return result;
}