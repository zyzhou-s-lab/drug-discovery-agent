"""In-memory LRU of trained SCGEN models + idle-unload to free the shared A100.

A trained model is keyed by the DATASET + training setup (NOT the perturbation): one model
serves every stim_key, so the LRU lets "train once, predict many genes cheaply". Idle-unload
drops all models after PERTURB_IDLE_TIMEOUT of inactivity and calls torch.cuda.empty_cache(),
so a long-lived server doesn't hold GPU memory between bursts of work.

v1 is purely in-memory (disk persistence is a 2nd-iteration item).
"""
from __future__ import annotations

import hashlib
import threading
import time


def model_key(source, target, source_name, target_name, epochs, batch_size) -> str:
    raw = f"{source}|{target}|{source_name}|{target_name}|{epochs}|{batch_size}"
    return hashlib.sha1(raw.encode()).hexdigest()[:16]


class ModelCache:
    def __init__(self, capacity: int = 3, idle_timeout: int = 900):
        self.capacity = capacity
        self.idle_timeout = idle_timeout
        self._store: dict[str, tuple] = {}     # key -> cached value (model, adata_t_ctrl, ...)
        self._used: dict[str, float] = {}      # key -> last-used ts
        self._lock = threading.Lock()
        self._last_activity = time.time()

    def get(self, key: str):
        with self._lock:
            if key in self._store:
                now = time.time()
                self._used[key] = now
                self._last_activity = now
                return self._store[key]
            return None

    def put(self, key: str, value: tuple) -> None:
        with self._lock:
            self._store[key] = value
            now = time.time()
            self._used[key] = now
            self._last_activity = now
            while len(self._store) > self.capacity:
                self._evict_locked(min(self._used, key=self._used.get))

    def _evict_locked(self, key: str) -> None:
        self._store.pop(key, None)
        self._used.pop(key, None)
        self._free_gpu()

    @staticmethod
    def _free_gpu() -> None:
        try:
            import gc

            import torch
            gc.collect()
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except Exception:  # noqa: BLE001 — best-effort; never fail a request on cleanup
            pass

    def sweep_idle(self) -> bool:
        """Drop everything if the server has been idle past the timeout. Returns True if it did."""
        with self._lock:
            if self._store and (time.time() - self._last_activity) > self.idle_timeout:
                for k in list(self._store):
                    self._evict_locked(k)
                return True
            return False
