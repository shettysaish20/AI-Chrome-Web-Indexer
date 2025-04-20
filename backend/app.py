#!/usr/bin/env python
"""
app.py - Flask API for the Chrome Web Indexer
This is the main entry point for the backend service that:
1. Receives web page content from the Chrome extension
2. Processes and indexes content using embeddings
3. Provides search functionality for the Chrome extension
4. Offers chatbot capabilities with Gemini integration
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
import os
import logging
from pathlib import Path
import json
import time

from agent import Agent
from perception import extract_perception
from memory import MemoryManager
from decision import decide_action
from action import perform_action
from chat import generate_chat_response

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Create Flask app
app = Flask(__name__)
CORS(app)  # Enable Cross-Origin Resource Sharing for the Chrome extension

# Initialize components
ROOT_DIR = Path(__file__).parent.resolve()
INDEX_DIR = ROOT_DIR / "index"
INDEX_DIR.mkdir(exist_ok=True)

# Initialize the agent and memory manager
memory_manager = MemoryManager(index_dir=INDEX_DIR)
agent = Agent(memory=memory_manager)

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({"status": "ok", "timestamp": time.time()})

@app.route('/index', methods=['POST'])
def index_page():
    """
    Receive web page content from the Chrome extension, 
    extract perception, and index it
    """
    try:
        data = request.json
        if not data:
            return jsonify({"error": "No data provided"}), 400
            
        url = data.get('url')
        title = data.get('title', '')
        content = data.get('content')
        
        if not url or not content:
            return jsonify({"error": "URL and content are required"}), 400
            
        logger.info(f"Indexing page: {url[:60]}...")
        
        # Process the page through our agent pipeline
        perception_result = extract_perception(content, url, title)
        
        if perception_result.is_confidential:
            logger.info(f"Skipping confidential page: {url}")
            return jsonify({
                "status": "skipped",
                "message": "Confidential page not indexed"
            })
            
        # Index the page content
        doc_id = memory_manager.add_document(
            url=url,
            title=title,
            content=perception_result.content,
            chunks=perception_result.chunks
        )
        
        return jsonify({
            "status": "success",
            "message": "Page indexed successfully",
            "doc_id": doc_id
        })
        
    except Exception as e:
        logger.error(f"Error indexing page: {str(e)}", exc_info=True)
        return jsonify({"error": str(e)}), 500

@app.route('/search', methods=['GET'])
def search():
    """
    Search for content in the index
    """
    try:
        query = request.args.get('q')
        if not query:
            return jsonify({"error": "Query parameter 'q' is required"}), 400
            
        logger.info(f"Searching for: {query}")
        
        # Use our agent to process the search
        results = agent.process_search(query)
        
        return jsonify({
            "status": "success",
            "results": results
        })
        
    except Exception as e:
        logger.error(f"Error searching: {str(e)}", exc_info=True)
        return jsonify({"error": str(e)}), 500

@app.route('/chat', methods=['POST'])
def chat():
    """
    Generate a chat response using Gemini based on indexed content
    """
    try:
        data = request.json
        if not data:
            return jsonify({"error": "No data provided"}), 400
            
        query = data.get('query')
        if not query:
            return jsonify({"error": "Query is required"}), 400
            
        logger.info(f"Chat query: {query}")
        
        # First, search for relevant context
        search_results = memory_manager.search(query, top_k=10)
        
        # Generate chat response using Gemini
        chat_response = generate_chat_response(query, search_results)
        
        # Return the response
        return jsonify({
            "status": "success",
            "text": chat_response.text,
            "sources": chat_response.sources
        })
        
    except Exception as e:
        logger.error(f"Error generating chat response: {str(e)}", exc_info=True)
        return jsonify({"error": str(e)}), 500

@app.route('/stats', methods=['GET'])
def get_stats():
    """Get indexing statistics"""
    try:
        stats = memory_manager.get_stats()
        return jsonify({
            "status": "success",
            "stats": stats
        })
    except Exception as e:
        logger.error(f"Error getting stats: {str(e)}", exc_info=True)
        return jsonify({"error": str(e)}), 500

@app.route('/clear', methods=['POST'])
def clear_index():
    """Clear the index (for testing/development)"""
    try:
        memory_manager.clear()
        return jsonify({
            "status": "success",
            "message": "Index cleared"
        })
    except Exception as e:
        logger.error(f"Error clearing index: {str(e)}", exc_info=True)
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    # Create index directory if it doesn't exist
    INDEX_DIR.mkdir(parents=True, exist_ok=True)
    
    # Initialize the index
    memory_manager.initialize()
    
    # Start the Flask app
    app.run(debug=True, port=5000)