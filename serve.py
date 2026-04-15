#!/bin/env python3
import http.server
import socketserver
import webbrowser
import os
import threading

# --- Configuration ---
PORT = 8000
HOST = "localhost"
# Get the directory where the script is located, so it serves the correct files.
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

def open_browser():
    """
    Starts a web browser pointing to the server's address.
    """
    url = f"http://{HOST}:{PORT}"
    print(f"If your browser doesn't open, please navigate to: {url}")
    webbrowser.open(url)

if __name__ == "__main__":
    with socketserver.TCPServer((HOST, PORT), Handler) as httpd:
        print(f"Serving your app at http://{HOST}:{PORT}")
        print(f"Serving files from: {DIRECTORY}")
        print("Press Ctrl+C to stop the server.")

        # Open the browser in a separate thread after a short delay
        # to ensure the server is ready.
        threading.Timer(1, open_browser).start()

        # Start the server
        httpd.serve_forever()