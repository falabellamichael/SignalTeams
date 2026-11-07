import React, { useEffect, useState } from "react";
import { api } from "../../../api";
import { Avatar } from "../../../util";

export function ReviewsTab({ agent, me }) {
  const [reviews, setReviews] = useState([]);
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState("");
  const [sent, setSent] = useState("");

  const load = () => api.reviews(agent.id).then(setReviews).catch(() => {});
  useEffect(() => { load(); }, [agent.id]);

  async function submit() {
    await api.postReview(agent.id, rating, body).catch(() => {});
    setBody(""); setSent("review saved ✓");
    setTimeout(() => setSent(""), 1500);
    load();
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 4, alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 11.5, color: "var(--dim)", marginRight: 6 }}>Your rating:</span>
        {[1, 2, 3, 4, 5].map((n) => (
          <span key={n} className={`rate-star ${rating >= n ? "on" : ""}`}
            onClick={() => setRating(n)}>★</span>
        ))}
      </div>
      <textarea style={{ width: "100%", minHeight: 54 }} placeholder="How's it working for you?"
        value={body} onChange={(e) => setBody(e.target.value)} />
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
        <button className="primary" onClick={submit} disabled={!rating && !body.trim()}>Post review</button>
        {sent && <span style={{ fontSize: 11.5, color: "var(--good)" }}>{sent}</span>}
      </div>
      <div style={{ marginTop: 14, maxHeight: 220, overflowY: "auto" }}>
        {reviews.map((r) => (
          <div key={r.id} className="rev">
            <div className="rev-head">
              <Avatar user={r.user} size="sm" />
              <b style={{ fontSize: 12.5 }}>{r.user.display_name}</b>
              <span className="rate-stars">{r.rating ? "★".repeat(r.rating) : ""}</span>
              <span style={{ fontSize: 10.5, color: "var(--dim)", marginLeft: "auto" }}>
                {new Date(r.created_at * 1000).toLocaleDateString()}</span>
            </div>
            {r.body && <div className="rev-body">{r.body}</div>}
          </div>
        ))}
        {reviews.length === 0 && <div style={{ color: "var(--dim)", fontSize: 12 }}>No reviews yet — be first.</div>}
      </div>
    </div>
  );
}
