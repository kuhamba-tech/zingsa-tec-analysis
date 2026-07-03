"""Geomagnetically Induced Current (GIC) monitoring for the ZETDC grid.

Implements the ZINGSA/ZETDC collaborative GIC monitoring programme
(Muchini et al., Scientific African 2026; ZINGSA GIC field deployment):
transformer-neutral GIC measurements captured by CR1000 dataloggers,
relayed by Raspberry Pi gateways, and analysed against space-weather
indices (Kp, Dst) for storm attribution.

No demo/synthetic measurements are ever produced by this package — all
series come from ingested field data.
"""
