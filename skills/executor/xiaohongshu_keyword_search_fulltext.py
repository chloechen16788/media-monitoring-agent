#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Xiaohongshu keyword search with note body. Writes xlsx under ./workspace."""

from __future__ import annotations

from _xiaohongshu_tikhub import emit_main

if __name__ == "__main__":
    emit_main(with_body=True)
