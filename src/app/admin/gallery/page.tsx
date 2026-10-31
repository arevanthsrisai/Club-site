"use client";

import { useState, useEffect } from "react";
import { getEvents } from "@/lib/api";
import { Event } from "@/types";
import { Calendar, Image as ImageIcon, ArrowRight, Loader2 } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import PageHeader from "@/components/ui/PageHeader";

export default function AdminGalleryDashboard() {
    const [events, setEvents] = useState<Event[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchEvents = async () => {
            const data = await getEvents();
            // Sort by date descending
            setEvents(data.sort((a, b) => b.date.localeCompare(a.date)));
            setLoading(false);
        };
        fetchEvents();
    }, []);

    if (loading) return <div className="p-8 text-white"><Loader2 className="animate-spin" /> Loading Events...</div>;

    return (
        <div className="max-w-6xl mx-auto text-white">
            <PageHeader
                title="Manage Event Galleries"
                subtitle="Select an event to add photos and videos."
                icon={<ImageIcon size={26} />}
            />

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {events.map((event) => (
                    <Link
                        key={event.id}
                        href={`/admin/gallery/${event.id}`}
                        className="group bg-white/5 border border-white/10 rounded-xl overflow-hidden hover:bg-white/10 hover:border-blue-500/50 transition-all hover:scale-[1.02]"
                    >
                        {/* Event Thumbnail (reuse event image if available) */}
                        <div className="h-40 bg-black/50 relative">
                            {event.image ? (
                                <Image src={event.image} alt={event.title} fill sizes="(max-width: 767px) 100vw, (max-width: 1023px) calc(50vw - 172px), calc(33.333vw - 123px)" className="object-cover opacity-60 group-hover:opacity-80 transition-opacity" />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center text-gray-600">
                                    <ImageIcon size={32} />
                                </div>
                            )}
                            <div className="absolute top-2 right-2 bg-black/60 px-2 py-1 rounded text-xs">
                                {event.date}
                            </div>
                        </div>

                        <div className="p-6">
                            <h2 className="text-lg font-bold mb-2 line-clamp-1 group-hover:text-blue-400 transition-colors">{event.title}</h2>
                            <p className="text-gray-400 text-sm mb-4 line-clamp-2">{event.description}</p>

                            <div className="flex items-center gap-2 text-blue-400 text-sm font-bold">
                                Manage Photos <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
                            </div>
                        </div>
                    </Link>
                ))}
            </div>
        </div>
    );
}
