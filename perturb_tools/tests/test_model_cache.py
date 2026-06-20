"""Pure-logic unit tests for the SCGEN model LRU + cache key — no scgen / torch / GPU needed,
so they run in the dda CI. The heavy compute paths (scgen_core/oneshot) need the scgen conda env
and real .h5ad data; those are covered when that env is wired (forward-looking, see README)."""
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))  # make perturb_scgen importable

from perturb_scgen.model_cache import ModelCache, model_key  # noqa: E402


def test_model_key_deterministic_and_setup_sensitive():
    a = model_key("s.h5ad", "t.h5ad", "Tcell", "Bcell", 100, 32)
    assert a == model_key("s.h5ad", "t.h5ad", "Tcell", "Bcell", 100, 32)   # stable across calls
    assert a != model_key("s.h5ad", "t.h5ad", "Tcell", "Bcell", 200, 32)   # epochs differ -> new key
    assert a != model_key("s.h5ad", "t.h5ad", "Bcell", "Tcell", 100, 32)   # cell-types differ
    assert len(a) == 16


def test_lru_get_put_and_capacity_eviction():
    c = ModelCache(capacity=2, idle_timeout=900)
    assert c.get("k1") is None                 # miss
    c.put("k1", ("m1",)); time.sleep(0.002)
    c.put("k2", ("m2",)); time.sleep(0.002)
    assert c.get("k1") == ("m1",)              # touch k1 -> k2 becomes least-recently-used
    time.sleep(0.002)
    c.put("k3", ("m3",))                        # over capacity -> evict the LRU (k2)
    assert c.get("k2") is None
    assert c.get("k1") == ("m1",) and c.get("k3") == ("m3",)


def test_sweep_idle_drops_when_stale():
    c = ModelCache(capacity=2, idle_timeout=-1)  # any elapsed counts as idle -> deterministic
    c.put("k1", ("m1",))
    assert c.sweep_idle() is True                # stale -> dropped
    assert c.get("k1") is None
    assert c.sweep_idle() is False               # empty -> nothing to drop
