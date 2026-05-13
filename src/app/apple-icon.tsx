import { ImageResponse } from "next/og";

export const runtime = "edge";

export const size = {
  width: 180,
  height: 180,
};

export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "180px",
          height: "180px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background:
            "linear-gradient(135deg, #0f172a 0%, #1e293b 48%, #020617 100%)",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "radial-gradient(circle at 30% 20%, rgba(255,255,255,0.20) 0%, rgba(255,255,255,0) 40%), radial-gradient(circle at 70% 80%, rgba(59,130,246,0.30) 0%, rgba(59,130,246,0) 38%)",
          }}
        />

        <div
          style={{
            width: "126px",
            height: "126px",
            borderRadius: "42px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(255,255,255,0.96)",
            boxShadow: "0 12px 30px rgba(0,0,0,0.35)",
          }}
        >
          <div
            style={{
              width: "92px",
              height: "92px",
              borderRadius: "30px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "flex-end",
                justifyContent: "center",
                gap: "5px",
              }}
            >
              <div
                style={{
                  width: "15px",
                  height: "45px",
                  borderRadius: "10px",
                  background: "#0f172a",
                }}
              />
              <div
                style={{
                  width: "15px",
                  height: "60px",
                  borderRadius: "10px",
                  background: "#2563eb",
                }}
              />
              <div
                style={{
                  width: "15px",
                  height: "35px",
                  borderRadius: "10px",
                  background: "#0f172a",
                }}
              />
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