"""Mockup scene registry. Each scene module registers builders with @mockup(...)."""
REGISTRY = {}
ORDER = []
CATEGORIES = ['Apparel', 'Outdoor', 'Print', 'Packaging', 'Devices', 'Home']


def mockup(id, label, category, aspect, res=(1600, 1600), tint=False, colors=None, albedo=0.85,
           target=0.95, exposure=None, samples=96, credit='Rendered for Digital Canvas (CC0)', pct=85):
    """albedo: linear albedo (or emission) of the blank print surface, used to derive shade.
    target: linear irradiance the print surface's `pct` percentile is exposed to (1.0 = design shows true)."""
    def deco(fn):
        REGISTRY[id] = dict(id=id, label=label, category=category, aspect=aspect, width=res[0], height=res[1],
                            tint=tint, colors=colors or [], albedo=albedo, target=target, exposure=exposure,
                            samples=samples, credit=credit, pct=pct, build=fn)
        ORDER.append(id)
        return fn
    return deco


def load_all():
    from . import apparel, outdoor, printed, packaging, devices, home  # noqa: F401
    return REGISTRY
