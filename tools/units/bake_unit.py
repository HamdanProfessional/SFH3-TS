#!/usr/bin/env python3
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bake_unit_parts

if __name__ == "__main__":
    bake_unit_parts.main()
