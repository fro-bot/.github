# Test app.py

from src import app


def test_app():
    assert app.main() == "Hello, world!"
