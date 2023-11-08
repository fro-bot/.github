# Test app.py

import pytest
from src import app


def test_app():
    assert app.main() == "Hello, world!"
