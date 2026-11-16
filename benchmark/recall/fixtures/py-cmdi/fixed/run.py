import subprocess
from flask import request

def ping():
    host = request.args["host"]
    subprocess.run(["ping", "-c", "1", host], check=True)
