import http.server
import socketserver
import os
import json
import webbrowser
import threading
import time

PORT = 8000
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

class RewariRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def do_POST(self):
        if self.path == '/api/save-beats':
            try:
                content_length = int(self.headers.get('Content-Length', 0))
                body = self.rfile.read(content_length).decode('utf-8')
                data = json.loads(body)

                # 1. Save KML if provided
                if 'kml' in data and data['kml']:
                    kml_path = os.path.join(DIRECTORY, 'Rewari_30_Sweeper_Beats_Freeform.kml')
                    with open(kml_path, 'w', encoding='utf-8') as f:
                        f.write(data['kml'])
                    print("Updated Rewari_30_Sweeper_Beats_Freeform.kml on disk.")

                # 2. Save GeoJSON if provided
                geojson_str = None
                if 'geojson' in data and data['geojson']:
                    geojson_str = data['geojson'] if isinstance(data['geojson'], str) else json.dumps(data['geojson'], indent=2)
                    geojson_path = os.path.join(DIRECTORY, 'Rewari_30_Sweeper_Beats_Freeform.geojson')
                    with open(geojson_path, 'w', encoding='utf-8') as f:
                        f.write(geojson_str)
                    print("Updated Rewari_30_Sweeper_Beats_Freeform.geojson on disk.")

                # 3. Update js/rewari-data.js so changes persist even if opened via file:/// later!
                if geojson_str:
                    data_js_path = os.path.join(DIRECTORY, 'js', 'rewari-data.js')
                    if os.path.exists(data_js_path):
                        with open(data_js_path, 'r', encoding='utf-8') as f:
                            content = f.read()
                        
                        # Replace window.REWARI_DEFAULT_BEATS = ...;
                        import re
                        pattern = r'window\.REWARI_DEFAULT_BEATS\s*=\s*\{.*?\};\n\n'
                        # Read old file and rebuild
                        wards_match = re.search(r'window\.REWARI_WARDS\s*=\s*(\{.*?\});', content, re.DOTALL)
                        roads_match = re.search(r'window\.REWARI_CLEAN_ROADS\s*=\s*(\{.*?\});', content, re.DOTALL)
                        
                        wards_part = wards_match.group(1) if wards_match else "{}"
                        roads_part = roads_match.group(1) if roads_match else "{}"
                        
                        new_content = (
                            "/**\n * Embedded Datasets for Offline & file:// Execution in Rewari Sweeper Beat Planning System\n */\n"
                            f"window.REWARI_DEFAULT_BEATS = {geojson_str};\n\n"
                            f"window.REWARI_WARDS = {wards_part};\n\n"
                            f"window.REWARI_CLEAN_ROADS = {roads_part};\n"
                        )
                        with open(data_js_path, 'w', encoding='utf-8') as f:
                            f.write(new_content)
                        print("Updated js/rewari-data.js on disk.")

                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'status': 'success', 'message': 'Saved to files on disk'}).encode('utf-8'))
            except Exception as e:
                print("Error saving beats:", e)
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'status': 'error', 'message': str(e)}).encode('utf-8'))
        else:
            self.send_response(404)
            self.end_headers()

def open_browser():
    time.sleep(1)
    webbrowser.open(f'http://localhost:{PORT}')

if __name__ == '__main__':
    with socketserver.TCPServer(("", PORT), RewariRequestHandler) as httpd:
        print(f"==================================================")
        print(f" Rewari Sweeper Beat Planning Server Running at:")
        print(f" http://localhost:{PORT}")
        print(f" Press Ctrl+C to stop.")
        print(f"==================================================")
        threading.Thread(target=open_browser, daemon=True).start()
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServer stopped.")
