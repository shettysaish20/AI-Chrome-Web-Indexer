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