import styles from "@renderer/css/pages/Home.module.css";
import { getRelativeTime } from "@renderer/util";
import { useState, useRef, useEffect } from "react";
import { News } from "../../../..//shared/types";

export default function NewsWidget() {
	const [news, setNews] = useState<News[]>([]);
	const [index, setIndex] = useState(0);
	const pRef = useRef<HTMLParagraphElement>(null);
	const intervalRef = useRef<NodeJS.Timeout | null>(null);

	function changeIndexBy(amount: number) {
		setIndex((i) => {
			let newIndex = i + amount;
			if (newIndex < 0) newIndex = news.length - 1;
			if (newIndex >= news.length) newIndex = 0;
			setNews((news) => {
				if (news[newIndex].body !== news[i]?.body) {
					if (pRef.current) {
						pRef.current.animate(
							[
								{
									opacity: 0,
								},
								{
									opacity: 0.6,
								},
							],
							{
								duration: 250,
								fill: "forwards",
								easing: "steps(4, end)",
							},
						);
					}
				}
				return news;
			});
			return newIndex;
		});

		// Clear the existing interval and start a new one
		if (intervalRef.current) {
			clearInterval(intervalRef.current);
		}
		intervalRef.current = setInterval(() => {
			changeIndexBy(1);
		}, 1000 * 10);
	}

	useEffect(() => {
		const fetchNews = async () => {
			const res = await fetch(
				`https://gist.github.com/mapliee/0f49178984d1b163337d700cdcc10232/raw?bust=${Date.now()}`,
			);
			const json = await res.json();
			setNews(json);
		};
		fetchNews();
		const interval = setInterval(fetchNews, 1000 * 15);
		return () => {
			clearInterval(interval);
		};
	}, []);

	useEffect(() => {
		intervalRef.current = setInterval(() => {
			changeIndexBy(1);
		}, 1000 * 10);
		return () => {
			if (intervalRef.current) {
				clearInterval(intervalRef.current);
			}
		};
	}, []);

	return (
		<div className={styles.newsWidget}>
			<div className={styles.newsHeader}>
				<h1>What's new</h1>
				<div className={styles.newsButtons}>
					<div
						onClick={() => changeIndexBy(-1)}
						className={`${styles.newsButton} ${styles.left}`}
					/>
					<div
						onClick={() => changeIndexBy(1)}
						className={`${styles.newsButton} ${styles.right}`}
					/>
				</div>
			</div>
			<div
				ref={pRef}
				style={{
					opacity: 0.6,
				}}
			>
				{news[index]?.date && (
					<p className={styles.relativeTime}>
						{getRelativeTime(news[index]?.date)}
					</p>
				)}
				{news.length ? (
					<p dangerouslySetInnerHTML={{ __html: news[index]?.body }} />
				) : (
					<p>Loading...</p>
				)}
			</div>
		</div>
	);
}
