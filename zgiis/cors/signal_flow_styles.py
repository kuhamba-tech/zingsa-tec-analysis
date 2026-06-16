"""CSS for the CORS hardware signal-flow diagram (shared by theme + iframe)."""

CORS_SIGNAL_FLOW_CSS = """
.cors-signal-flow {
    width: 100%;
    max-width: 100%;
    min-width: 0;
    background: linear-gradient(155deg, rgba(0, 0, 0, 0.98), rgba(6, 13, 26, 0.96));
    border: 1px solid #244d73;
    border-radius: 16px;
    padding: 1.2rem 1.15rem 1rem;
    box-sizing: border-box;
    box-shadow: 0 14px 36px rgba(0, 0, 0, 0.28);
}
.cors-signal-flow-head {
    color: #168bd2;
    font-weight: 800;
    font-size: 0.8rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    margin-bottom: 0.85rem;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid rgba(30, 58, 95, 0.55);
}
.cors-signal-flow-inline {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 5.25rem minmax(0, 1fr) 5.25rem minmax(0, 1fr) 5.25rem minmax(0, 1fr);
    align-items: stretch;
    gap: 0.5rem 0.35rem;
    width: 100%;
    box-sizing: border-box;
}
.cors-flow-stage {
    --stage-accent: #168bd2;
    position: relative;
    min-width: 0;
    height: 100%;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 0.45rem;
    padding: 0.65rem 0.5rem 0.7rem;
    background: rgba(7, 18, 32, 0.72);
    border: 1px solid rgba(30, 58, 95, 0.75);
    border-radius: 14px;
    box-shadow:
        0 0 0 1px rgba(255, 255, 255, 0.03) inset,
        0 10px 24px rgba(0, 0, 0, 0.22);
    box-sizing: border-box;
    overflow: hidden;
}
.cors-flow-stage-badge {
    position: absolute;
    top: 0.5rem;
    left: 0.5rem;
    width: 1.35rem;
    height: 1.35rem;
    border-radius: 999px;
    color: #000000;
    font-size: 0.68rem;
    font-weight: 900;
    line-height: 1.35rem;
    text-align: center;
    z-index: 2;
    box-shadow: 0 0 14px color-mix(in srgb, var(--stage-accent) 55%, transparent);
}
.cors-flow-img-wrap {
    position: relative;
    width: 100%;
    flex: 0 0 auto;
    aspect-ratio: 4 / 3;
    max-height: 126px;
    min-height: 96px;
    background:
        radial-gradient(circle at 50% 28%, rgba(255, 255, 255, 0.98) 0%, rgba(241, 245, 249, 0.96) 42%, rgba(226, 232, 240, 0.92) 100%);
    border: 3px solid var(--stage-accent, #244d73);
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0.5rem 0.4rem;
    box-shadow:
        0 0 28px color-mix(in srgb, var(--stage-accent) 28%, transparent),
        0 8px 20px rgba(0, 0, 0, 0.24);
    box-sizing: border-box;
    overflow: hidden;
}
.cors-flow-img-spotlight {
    position: absolute;
    inset: 12% 10% 18%;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(255, 255, 255, 0.55) 0%, transparent 72%);
    pointer-events: none;
}
.cors-flow-img-duo {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.25rem;
    width: 100%;
    height: 100%;
    max-height: 100%;
}
.cors-flow-img-duo .cors-flow-img {
    width: 47%;
    height: auto;
    max-height: 100%;
}
.cors-flow-img {
    position: relative;
    z-index: 1;
    width: auto;
    height: auto;
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    display: block;
    margin: 0 auto;
    filter: drop-shadow(0 6px 10px rgba(15, 23, 42, 0.22));
}
.cors-flow-img-fallback {
    font-size: 2.1rem;
    line-height: 1;
}
.cors-flow-stage-body {
    display: flex;
    flex-direction: column;
    gap: 0.22rem;
    padding: 0 0.05rem;
    flex: 1 1 auto;
    justify-content: flex-start;
    min-height: 0;
}
.cors-flow-stage-title {
    font-size: 0.74rem;
    font-weight: 800;
    line-height: 1.2;
    overflow-wrap: anywhere;
    word-break: break-word;
    hyphens: auto;
}
.cors-flow-stage-caption {
    font-size: 0.64rem;
    color: #ffffff;
    line-height: 1.35;
    font-weight: 600;
    overflow-wrap: anywhere;
    word-break: break-word;
}
.cors-flow-stage-detail {
    display: block;
    font-size: 0.58rem;
    color: rgba(255, 255, 255, 0.82);
    line-height: 1.35;
    overflow-wrap: anywhere;
    word-break: break-word;
}
.cors-flow-connector {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    min-width: 0;
    width: 100%;
    padding: 0.35rem 0.15rem;
    box-sizing: border-box;
    align-self: stretch;
}
.cors-flow-connector-track {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    min-height: 2rem;
    margin-bottom: 0.35rem;
    flex-shrink: 0;
}
.cors-flow-arrow {
    color: #168bd2;
    font-size: 1.45rem;
    font-weight: 800;
    line-height: 1;
    text-shadow: 0 0 12px rgba(0, 212, 255, 0.45);
}
.cors-flow-pulse {
    position: absolute;
    width: 0.42rem;
    height: 0.42rem;
    border-radius: 50%;
    background: #168bd2;
    box-shadow: 0 0 10px #168bd2;
    animation: cors-flow-pulse 2.2s ease-in-out infinite;
    opacity: 0.85;
}
@keyframes cors-flow-pulse {
    0%, 100% { transform: translateX(-0.85rem); opacity: 0.2; }
    50% { transform: translateX(0.85rem); opacity: 1; }
}
.cors-flow-connector-label {
    width: 100%;
    max-width: 5rem;
    font-size: 0.54rem;
    color: #ffffff;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.02em;
    line-height: 1.2;
    overflow-wrap: anywhere;
    word-break: break-word;
}
.cors-flow-connector-note {
    width: 100%;
    max-width: 5rem;
    font-size: 0.5rem;
    color: rgba(255, 255, 255, 0.88);
    margin-top: 0.12rem;
    line-height: 1.2;
    overflow-wrap: anywhere;
    word-break: break-word;
}
.cors-flow-path-strip,
.cors-signal-flow-grid-4x2 {
    display: none;
}
.cors-signal-flow-foot {
    margin-top: 0.75rem;
    padding-top: 0.65rem;
    border-top: 1px solid rgba(30, 58, 95, 0.55);
    font-size: 0.64rem;
    color: #ffffff;
    line-height: 1.45;
}
.cors-signal-flow-foot code {
    color: #ffffff;
    font-size: 0.6rem;
}
@media (max-width: 980px) {
    .cors-signal-flow-inline {
        display: flex;
        flex-wrap: nowrap;
        overflow-x: auto;
        padding-bottom: 0.35rem;
        gap: 0.45rem;
    }
    .cors-flow-stage {
        flex: 0 0 158px;
        min-width: 158px;
    }
    .cors-flow-connector {
        flex: 0 0 4.5rem;
        min-width: 4.5rem;
    }
}
"""
