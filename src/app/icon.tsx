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
          background: "#0f172a",
        }}
      >
        <div
          style={{
            width: "1024px",
            height: "1024px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background:
              "linear-gradient(135deg, #0f172a 0%, #1e293b 45%, #020617 100%)",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              background:
                "radial-gradient(circle at 30% 20%, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 34%), radial-gradient(circle at 70% 80%, rgba(59,130,246,0.28) 0%, rgba(59,130,246,0) 36%)",
            }}
          />

          <div
            style={{
              width: "690px",
              height: "690px",
              borderRadius: "220px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(255,255,255,0.96)",
              boxShadow: "0 50px 120px rgba(0,0,0,0.38)",
            }}
          >
            <div
              style={{
                width: "500px",
                height: "500px",
                borderRadius: "155px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background:
                  "linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "26px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-end",
                    justifyContent: "center",
                    gap: "26px",
                  }}
                >
                  <div
                    style={{
                      width: "88px",
                      height: "245px",
                      borderRadius: "44px",
                      background: "#0f172a",
                    }}
                  />
                  <div
                    style={{
                      width: "88px",
                      height: "330px",
                      borderRadius: "44px",
                      background: "#2563eb",
                    }}
                  />
                  <div
                    style={{
                      width: "88px",
                      height: "190px",
                      borderRadius: "44px",
                      background: "#0f172a",
                    }}
                  />
                </div>

                <div
                  style={{
                    width: "360px",
                    height: "56px",
                    borderRadius: "999px",
                    background: "#0f172a",
                  }}
                />
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