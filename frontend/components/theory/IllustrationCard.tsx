import type { TheoryIllustration } from "@/lib/types";

type Props = {
  illustration: TheoryIllustration;
};

export default function IllustrationCard({ illustration }: Props) {
  const { accent, num, short, caption, svg } = illustration;
  const cardClass =
    illustration.step_id === "9"
      ? "vtec-illus-card vtec-step9-card"
      : illustration.step_id === "10"
        ? "vtec-illus-card vtec-step10-card"
        : "vtec-illus-card";

  return (
    <div className={cardClass}>
      <div
        className="vtec-illus-step-badge"
        style={{ borderColor: accent, color: accent }}
      >
        STEP {num}
      </div>
      {short ? <div className="vtec-illus-step-title">{short}</div> : null}
      <div className="vtec-illus-caption">{caption}</div>
      <div
        className="vtec-illus-svg-wrap"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </div>
  );
}
