// Boot/reload screen: full-desktop overlay shown on initial load until the
// Excalidraw canvas signals ready. Icon-only 8-bit floppy loader (96px = 2x
// the original 48px snippet, viewBox untouched so pixels stay 6x crisp).
export default function BootScreen() {
  return (
    <div className="boot-screen" role="status" aria-label="Loading Paint97">
      <svg
        className="floppy-loader" viewBox="0 0 16 16"
        xmlns="http://www.w3.org/2000/svg"
        role="img" aria-label="Loading"
      >
        {/* shell base (chamfered top-left) */}
        <polygon points="3,0 15,0 15,15 0,15 0,3" fill="#000080" />

        {/* shell highlights (top-left bevel) */}
        <rect x="3" y="0" width="12" height="1" fill="#4040c0" />
        <rect x="0" y="3" width="1" height="12" fill="#4040c0" />
        <rect x="1" y="2" width="1" height="1" fill="#4040c0" />
        <rect x="2" y="1" width="1" height="1" fill="#4040c0" />

        {/* shell shadows (bottom-right bevel) */}
        <rect x="0" y="15" width="16" height="1" fill="#000040" />
        <rect x="15" y="0" width="1" height="16" fill="#000040" />

        {/* magnetic media opening */}
        <rect x="4" y="2" width="4" height="4" fill="#000000" />

        {/* sliding metal shutter */}
        <g className="shutter">
          <rect x="4" y="2" width="6" height="4" fill="#c0c0c0" />
          <rect x="4" y="2" width="6" height="1" fill="#ffffff" />
          <rect x="4" y="5" width="6" height="1" fill="#808080" />
          <rect x="8" y="3" width="1" height="2" fill="#000080" />
        </g>

        {/* activity LED */}
        <rect className="led" x="12" y="2" width="2" height="2" fill="#ff0000" />

        {/* label area */}
        <rect x="3" y="7" width="10" height="7" fill="#ffffff" />
        <rect x="3" y="7" width="10" height="1" fill="#c0c0c0" />
        <rect x="4" y="8" width="2" height="2" fill="#000080" />
        <rect x="4" y="11" width="8" height="1" fill="#c0c0c0" />
        <rect x="4" y="13" width="6" height="1" fill="#c0c0c0" />

        {/* write-protect tab */}
        <rect x="1" y="13" width="2" height="2" fill="#808080" />
        <rect x="1" y="13" width="1" height="2" fill="#c0c0c0" />
      </svg>
    </div>
  );
}
