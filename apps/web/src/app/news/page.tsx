import Link from "next/link";
import { getNews, type NewsSummary } from "../../lib/api";

export const dynamic = "force-dynamic";

const CATEGORIES = ["Market Report", "Sale Recap", "Ranch News"];

export default async function NewsIndex({ searchParams }: { searchParams: { category?: string } }) {
  const active = searchParams.category ?? "";
  const { posts } = await getNews(active || undefined);

  return (
    <main className="wrap section">
      <div className="eyebrow">Market desk</div>
      <h1 style={{ fontSize: 34, margin: "10px 0 20px" }}>News &amp; market reports</h1>

      <div className="filters" style={{ marginBottom: 26 }}>
        <Link href="/news" className={`filter ${active === "" ? "active" : ""}`}>All</Link>
        {CATEGORIES.map((c) => (
          <Link key={c} href={`/news?category=${encodeURIComponent(c)}`} className={`filter ${active === c ? "active" : ""}`}>
            {c}
          </Link>
        ))}
      </div>

      {posts.length === 0 ? (
        <div className="empty">Nothing published in this category yet.</div>
      ) : (
        <div className="news-grid">
          {posts.map((p) => <NewsCard key={p.slug} post={p} />)}
        </div>
      )}
    </main>
  );
}

function NewsCard({ post }: { post: NewsSummary }) {
  return (
    <Link href={`/news/${post.slug}`} className="news-card">
      <div className="eyebrow cat">{post.category}</div>
      <h3>{post.title}</h3>
      <p className="dek">{post.dek}</p>
      <div className="byline">{post.authorName} · {new Date(post.publishedAt).toLocaleDateString()}</div>
    </Link>
  );
}
