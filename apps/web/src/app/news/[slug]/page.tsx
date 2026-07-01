import Link from "next/link";
import { getNewsPost } from "../../../lib/api";

export const dynamic = "force-dynamic";

export default async function NewsDetail({ params }: { params: { slug: string } }) {
  const post = await getNewsPost(params.slug);
  if (!post) {
    return (
      <main className="wrap section">
        <p className="muted">Story not found.</p>
        <Link href="/news" className="btn-link">← Back to news</Link>
      </main>
    );
  }

  const paragraphs = post.body.split("\n\n").filter(Boolean);

  return (
    <main className="wrap">
      <div className="news-detail">
        <Link href="/news" className="crumb">← News</Link>
        <div className="eyebrow cat">{post.category}</div>
        <h1>{post.title}</h1>
        <p className="dek">{post.dek}</p>
        <div className="byline">
          {post.authorName}{post.authorTitle ? `, ${post.authorTitle}` : ""} · {new Date(post.publishedAt).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}
        </div>
        <div className="news-body">
          {paragraphs.map((p, i) => <p key={i}>{p}</p>)}
        </div>
      </div>
    </main>
  );
}
