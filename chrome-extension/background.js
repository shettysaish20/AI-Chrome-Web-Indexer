/**
 * background.js - Background script for the Chrome Web Indexer extension
 * Handles communication with the Flask API and manages indexing operations
 */

// Configuration
const API_BASE_URL = 'http://localhost:5000';
const DEBUG = true;

// Track which tabs have content scripts ready
const contentScriptReadyTabs = new Set();

// Logging helper
function log(message) {
  if (DEBUG) {
    console.log(`[WebIndexer] ${message}`);
  }
}

// Check if the Flask API is running
async function checkApiStatus() {
  try {
    const response = await fetch(`${API_BASE_URL}/health`);
    if (response.ok) {
      const data = await response.json();
      log(`API is running. Server time: ${new Date(data.timestamp * 1000).toLocaleTimeString()}`);
      return true;
    }
    return false;
  } catch (error) {
    log(`API not available: ${error.message}`);
    return false;
  }
}

// Index a web page using the API
async function indexPage(url, title, content) {
  try {
    log(`Indexing page: ${url}`);
    
    const response = await fetch(`${API_BASE_URL}/index`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ url, title, content })
    });
    
    if (!response.ok) {
      throw new Error(`API returned ${response.status}: ${response.statusText}`);
    }
    
    const result = await response.json();
    log(`Indexing result: ${result.status} - ${result.message || ''}`);
    
    return result;
  } catch (error) {
    log(`Error indexing page: ${error.message}`);
    throw error;
  }
}

// Perform a search using the API
async function search(query) {
  try {
    log(`Searching for: ${query}`);
    
    const response = await fetch(
      `${API_BASE_URL}/search?q=${encodeURIComponent(query)}`,
      { method: 'GET' }
    );
    
    if (!response.ok) {
      throw new Error(`API returned ${response.status}: ${response.statusText}`);
    }
    
    const result = await response.json();
    log(`Search returned ${result.results ? result.results.length : 0} results`);
    
    return result;
  } catch (error) {
    log(`Error searching: ${error.message}`);
    throw error;
  }
}

// Generate chat response using the API and Gemini
async function generateChatResponse(query) {
  try {
    log(`Generating chat response for: ${query}`);
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 second timeout
    
    const response = await fetch(`${API_BASE_URL}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ query }),
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API returned ${response.status}: ${errorText}`);
    }
    
    const result = await response.json();
    log(`Chat response generated with ${result.sources ? result.sources.length : 0} sources`);
    
    return result;
  } catch (error) {
    log(`Error generating chat response: ${error.message}`);
    throw error;
  }
}

// Get indexing statistics from the API
async function getStats() {
  try {
    const response = await fetch(`${API_BASE_URL}/stats`);
    
    if (!response.ok) {
      throw new Error(`API returned ${response.status}: ${response.statusText}`);
    }
    
    return await response.json();
  } catch (error) {
    log(`Error getting stats: ${error.message}`);
    throw error;
  }
}

// Handle content script message safely
function safelyMessageContentScript(tabId, message, callback) {
  try {
    chrome.tabs.sendMessage(
      tabId,
      message,
      (response) => {
        if (chrome.runtime.lastError) {
          log(`Error sending message to tab ${tabId}: ${chrome.runtime.lastError.message}`);
          if (callback) callback(null);
          return;
        }
        if (callback) callback(response);
      }
    );
  } catch (error) {
    log(`Exception sending message to tab ${tabId}: ${error.message}`);
    if (callback) callback(null);
  }
}

// Listen for tab updates to index visited pages
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Only process when the page has finished loading
  if (changeInfo.status !== 'complete' || !tab.url || tab.url.startsWith('chrome://')) {
    return;
  }
  
  // Check if API is available
  const apiAvailable = await checkApiStatus();
  if (!apiAvailable) {
    log('API not available, skipping indexing');
    return;
  }
  
  // Inject content script if needed and then ask for page content
  setTimeout(() => {
    // Even if content script is injected, give it time to initialize
    safelyMessageContentScript(
      tabId, 
      { action: 'extractContent' }, 
      async (response) => {
        if (!response) {
          log(`No response from content script in tab ${tabId}, script might not be ready`);
          return;
        }
        
        if (response.content) {
          try {
            // Index the page
            await indexPage(tab.url, tab.title, response.content);
          } catch (error) {
            log(`Failed to index page: ${error.message}`);
          }
        }
      }
    );
  }, 1000);  // Wait 1 second after page load
});

// Track when content scripts are ready
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'contentScriptReady' && sender.tab) {
    log(`Content script ready in tab ${sender.tab.id}`);
    contentScriptReadyTabs.add(sender.tab.id);
    sendResponse({ status: 'acknowledged' });
    return true;
  }
});

// Handle message passing from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'search') {
    search(message.query)
      .then(results => sendResponse(results))
      .catch(error => sendResponse({ error: error.message }));
    return true; // Indicates we'll respond asynchronously
  }
  
  if (message.action === 'generateChatResponse') {
    generateChatResponse(message.query)
      .then(response => sendResponse(response))
      .catch(error => sendResponse({ error: error.message }));
    return true; // Indicates we'll respond asynchronously
  }
  
  if (message.action === 'getStats') {
    getStats()
      .then(stats => sendResponse(stats))
      .catch(error => sendResponse({ error: error.message }));
    return true;
  }
  
  if (message.action === 'highlight') {
    const tabId = message.tabId || (sender.tab && sender.tab.id);
    const positions = message.positions;
    
    if (!tabId) {
      sendResponse({ error: 'No target tab specified for highlighting' });
      return true;
    }
    
    safelyMessageContentScript(tabId, { 
      action: 'highlight',
      positions: positions
    }, (response) => {
      sendResponse(response || { status: 'highlighting-sent' });
    });
    
    return true;
  }
});

// Listen for port connections from popup.js
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "popup-port") {
    port.onMessage.addListener((message) => {
      // Handle different message actions
      if (message.action === 'search') {
        search(message.query)
          .then(results => port.postMessage(results))
          .catch(error => port.postMessage({ error: error.message }));
      }
      
      else if (message.action === 'generateChatResponse') {
        generateChatResponse(message.query)
          .then(response => port.postMessage(response))
          .catch(error => port.postMessage({ error: error.message }));
      }
      
      else if (message.action === 'getStats') {
        getStats()
          .then(stats => port.postMessage(stats))
          .catch(error => port.postMessage({ error: error.message }));
      }
      
      else if (message.action === 'highlight') {
        const tabId = message.tabId;
        const positions = message.positions;
        
        if (!tabId) {
          port.postMessage({ error: 'No target tab specified for highlighting' });
          return;
        }
        
        safelyMessageContentScript(tabId, { 
          action: 'highlight',
          positions: positions
        }, (response) => {
          port.postMessage(response || { status: 'highlighting-sent' });
        });
      }
    });
    
    // Handle port disconnect
    port.onDisconnect.addListener(() => {
      const error = chrome.runtime.lastError;
      if (error) {
        log(`Port disconnected with error: ${error.message}`);
      }
    });
  }
});

// On extension install or update
chrome.runtime.onInstalled.addListener(() => {
  log('Extension installed/updated');
  checkApiStatus().then(status => {
    if (status) {
      log('API connection successful');
    } else {
      log('API not available. Please start the Flask backend.');
    }
  });
});