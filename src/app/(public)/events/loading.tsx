import PageLoading from "@/components/ui/PageLoading";

// /events renders server-side per request (revalidate 0), so this loading.tsx
// provides the visual handoff while event data streams in during navigation.
export default function Loading() {
    return <PageLoading />;
}
