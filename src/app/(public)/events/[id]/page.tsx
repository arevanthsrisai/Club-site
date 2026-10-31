"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import { subscribeToEvent, subscribeToEventGallery } from "@/lib/api";
import { Event, GalleryImage } from "@/types";
import { Calendar, Clock, MapPin, Play, Image as ImageIcon, ArrowLeft, Star, Loader2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import Markdown from "@/components/ui/Markdown";

export default function EventDetailPage() {
    const params = useParams();
    const router = useRouter();
    const eventId = params.id as string;

    // State
    const [event, setEvent] = useState<Event | null>(null);
    const [gallery, setGallery] = useState<GalleryImage[]>([]);
    const [loading, setLoading] = useState(true);



    useEffect(() => {
        if (!eventId) return;

        // Subscribe to Event Details
        const unsubEvent = subscribeToEvent(eventId, (updatedEvent) => {
            setEvent(updatedEvent);
            // If event is null (deleted), handle 404 behavior if needed, or stick with null state
            if (!updatedEvent) setLoading(false);
        });

        // Subscribe to Gallery
        const unsubGallery = subscribeToEventGallery(eventId, (updatedGallery) => {
            setGallery(updatedGallery);
            setLoading(false);
        });

        return () => {
            unsubEvent();
            unsubGallery();
        };
    }, [eventId]);

    if (loading) return (
        <div className="min-h-screen pt-32 flex flex-col items-center justify-center gap-4">
            <Loader2 size={40} className="animate-spin text-blue-500" />
            <p className="text-gray-400 text-sm">Loading event…</p>
        </div>
    );
    if (!event) return (
        <div className="min-h-screen pt-32 flex flex-col items-center justify-center gap-4 text-center px-4">
            <h1 className="text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-600">Event not found</h1>
            <p className="text-gray-400">This event may have been removed or the link is incorrect.</p>
            <Link href="/events" className="mt-2 px-6 py-2.5 rounded-full bg-white/10 border border-white/10 hover:bg-white/20 text-white text-sm font-bold transition-colors">
                Browse all events
            </Link>
        </div>
    );

    return (
        <div className="min-h-screen pt-32 md:pt-36 pb-12 px-4">
            <div className="max-w-6xl mx-auto">
                <Link href="/events" className="inline-flex items-center gap-2 text-gray-400 hover:text-white transition-colors text-sm font-medium">
                    <ArrowLeft size={18} /> Back to Events
                </Link>

                {/* Hero Section */}
                <div className="relative w-full h-[400px] md:h-[500px] rounded-3xl overflow-hidden mb-12 shadow-2xl shadow-blue-900/20">
                    <Image
                        src={event.image || "/images/event-placeholder.jpg"}
                        alt={event.title}
                        fill
                        sizes="min(calc(100vw - 32px), 1152px)"
                        className="object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black via-black/50 to-transparent" />

                    <div className="absolute bottom-0 left-0 p-8 md:p-12 w-full">
                        <h1 className="text-4xl md:text-6xl font-bold text-white mb-4 leading-tight">{event.title}</h1>

                        <div className="flex flex-wrap gap-4 md:gap-8">
                            <div className="flex items-center gap-2 text-gray-300 bg-white/10 px-4 py-2 rounded-full backdrop-blur-md">
                                <Calendar size={20} className="text-blue-400" />
                                <span>{event.date}</span>
                            </div>
                            <div className="flex items-center gap-2 text-gray-300 bg-white/10 px-4 py-2 rounded-full backdrop-blur-md">
                                <Clock size={20} className="text-purple-400" />
                                <span>{event.time || 'Time TBD'}</span>
                            </div>
                            <div className="flex items-center gap-2 text-gray-300 bg-white/10 px-4 py-2 rounded-full backdrop-blur-md">
                                <MapPin size={20} className="text-red-400" />
                                <span>{event.venue || 'Venue TBD'}</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Details Section */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-12 mb-16">
                    <div className="lg:col-span-2 max-w-none text-lg">
                        <h2 className="text-white font-bold text-2xl mb-4">About the Event</h2>
                        {/* Shared renderer: same safe pipeline + styling as the admin
                            preview; plain text still renders as plain paragraphs. */}
                        <Markdown>{event.fullDescription || event.description}</Markdown>

                        {event.details && event.details.length > 0 && (
                            <div className="mt-8">
                                <h3 className="text-white font-bold text-xl mb-4">Highlights</h3>
                                <ul className="space-y-2">
                                    {event.details.map((item, idx) => (
                                        <li key={idx} className="flex items-start gap-3">
                                            <span className="mt-2.5 w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
                                            <div className="min-w-0">
                                                <Markdown className="text-base">{item}</Markdown>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            </div>

                        )}
                    </div>

                    {/* Sidebar */}
                    <div className="space-y-6">
                        {/* Rating for past events */}
                        {event.status === 'past' && event.avgRating != null && event.avgRating > 0 && (
                            <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
                                <h3 className="text-white font-bold text-lg mb-3">Community Rating</h3>
                                <div className="flex items-center gap-2 mb-2">
                                    {[1, 2, 3, 4, 5].map((star) => (
                                        <Star
                                            key={star}
                                            size={22}
                                            className={star <= Math.round(event.avgRating!) ? 'text-yellow-400' : 'text-gray-600'}
                                            fill={star <= Math.round(event.avgRating!) ? 'currentColor' : 'none'}
                                        />
                                    ))}
                                </div>
                                <p className="text-yellow-400 font-bold text-2xl">{event.avgRating.toFixed(1)} <span className="text-gray-500 text-sm font-normal">/ 5.0</span></p>
                                <p className="text-gray-500 text-sm mt-1">{event.feedbackCount || 0} {event.feedbackCount === 1 ? 'review' : 'reviews'}</p>
                            </div>
                        )}
                    </div>
                </div>

                {/* Gallery Section */}
                {gallery.length > 0 && (
                    <div className="border-t border-white/10 pt-16">
                        <h2 className="text-3xl font-bold text-white mb-8 flex items-center gap-3">
                            <ImageIcon className="text-yellow-400" /> Event Gallery
                        </h2>

                        <div className="columns-1 md:columns-2 lg:columns-3 gap-4 space-y-4">
                            {gallery.map((media) => (
                                <div key={media.id} className="relative group break-inside-avoid rounded-xl overflow-hidden bg-white/5 border border-white/10">
                                    {/* Handle Video vs Image */}
                                    {media.type === 'video' ? (
                                        <div className="relative aspect-video">
                                            {/* Poster frame (generated server-side and stored in B2)
                                                so paused videos look intentional instead of black. */}
                                            <video
                                                src={media.src}
                                                poster={media.thumbnailKey ? `/api/gallery/media?key=${encodeURIComponent(media.thumbnailKey)}` : undefined}
                                                controls
                                                preload="metadata"
                                                className="w-full h-full object-cover"
                                            />
                                            <div className="absolute top-2 right-2 bg-black/50 px-2 py-1 rounded text-xs text-white flex items-center gap-1 pointer-events-none">
                                                <Play size={10} /> Video
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="relative w-full">
                                            <Image
                                                src={media.src}
                                                alt={media.alt || "Event Image"}
                                                width={0}
                                                height={0}
                                                sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                                                loading="lazy"
                                                className="w-full h-auto hover:scale-105 transition-transform duration-500"
                                            />
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {gallery.length === 0 && (
                    <div className="border-t border-white/10 pt-16 text-center text-gray-500">
                        <p>No photos or videos uploaded for this event yet.</p>
                    </div>
                )}

            </div>
        </div>
    );
}
