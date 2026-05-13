import { ImageResponse } from "next/og";

export const runtime = "edge";

export const size = {
  width: 1024,
  height: 1024,
};

export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "1024px",
          height: "1024px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#ffffff",
        }}
      >
        <div
          style={{
            width: "1024px",
            height: "1024px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#ffffff",
          }}
        >
          <div
            style={{
              width: "820px",
              height: "820px",
              borderRadius: "210px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "#ffffff",
              boxShadow: "0 40px 120px rgba(15, 23, 42, 0.18)",
              border: "1px solid rgba(226, 232, 240, 0.85)",
            }}
          >
            <div
              style={{
                width: "610px",
                height: "610px",
                borderRadius: "160px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "#f8fafc",
              }}
            >
              <div
                style={{
                  width: "390px",
                  height: "390px",
                  borderRadius: "120px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "#0f172a",
                }}
              >
                <div
                  style={{
                    fontSize: "190px",
                    fontWeight: 900,
                    color: "#ffffff",
                    letterSpacing: "-18px",
                    lineHeight: 1,
                  }}
                >
                  AE
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    ),
    {
      ...size,
    }
  );
}