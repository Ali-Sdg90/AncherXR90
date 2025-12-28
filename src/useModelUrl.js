import { useEffect, useState } from "react";

export function useModelUrl(primary, fallback) {
    const [url, setUrl] = useState(null);

    useEffect(() => {
        let cancelled = false;

        fetch(primary, { method: "HEAD", cache: "no-store" })
            .then((res) => {
                if (cancelled) return;
                setUrl(res.ok ? primary : fallback);
            })
            .catch(() => {
                if (cancelled) return;
                setUrl(fallback);
            });

        return () => {
            cancelled = true;
        };
    }, [primary, fallback]);

    return url;
}
