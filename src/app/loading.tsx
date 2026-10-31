import PageLoading from "@/components/ui/PageLoading";

// App-level fallback for segments without their own loading.tsx
// (auth pages, /events, etc.). Matches the shared public loader.
export default function Loading() {
    return <PageLoading />;
}
