#!/usr/bin/env python3
import os
import time

URL = os.environ.get("SFH3_URL", "http://localhost:5173/")


def nointro(url=None):
    return (url or URL).split("#", 1)[0] + "#nointro"


def wait_for_menu(page, timeout=180000):
    page.wait_for_function(
        "() => !!(window.__sfh3 && window.__sfh3.screen"
        " && window.__sfh3.screen.goto)", timeout=timeout)


def goto_menu(page, url=None, timeout=180000):
    page.goto(nointro(url), wait_until="domcontentloaded")
    page.wait_for_selector("canvas", timeout=timeout)
    wait_for_menu(page, timeout=timeout)


def wait_for_art(page, settle=4, timeout=20.0):
    last, stable, deadline = None, 0, time.time() + timeout
    while time.time() < deadline:
        now = page.evaluate(
            "() => window.sfh3Dev?.artEpochs ? window.sfh3Dev.artEpochs() : null")
        if now is None:
            time.sleep(1.0)
            return
        stable = stable + 1 if now == last else 0
        last = now
        if stable >= settle:
            break
        time.sleep(0.15)
    time.sleep(0.3)
