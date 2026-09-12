import Image from "next/image";
import { useState } from "react";

export function EvidenceImage({
  runId,
  kind,
}: {
  runId: string;
  kind: "failure" | "intervention";
}) {
  const [unavailable, setUnavailable] = useState(false);
  const label = kind === "failure" ? "Failure screenshot" : "Intervention screenshot";
  const source = `/api/runs/${runId}/images/${kind}.png`;
  return (
    <details className="evidence-image">
      <summary>{label}</summary>
      {unavailable ? (
        <p role="status">The screenshot is unavailable for this run.</p>
      ) : (
        <a
          href={source}
          target="_blank"
          rel="noreferrer"
          aria-label={`Open full ${label.toLowerCase()}`}
        >
          <Image
            src={source}
            width={1440}
            height={900}
            unoptimized
            alt={`${label} of the synthetic application, with sensitive values masked`}
            loading="lazy"
            onError={() => setUnavailable(true)}
          />
        </a>
      )}
    </details>
  );
}
