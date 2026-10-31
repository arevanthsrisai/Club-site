"use client";

import { useState } from "react";
import { saveMessage } from "@/lib/api";
import { Mail, MapPin, Send, Loader2, CheckCircle, AlertCircle, ArrowRight } from "lucide-react";

export default function ContactPage() {
    const [formData, setFormData] = useState({
        name: "",
        email: "",
        subject: "",
        message: ""
    });
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');
    const [errorMessage, setErrorMessage] = useState("Failed to send message. Please try again later.");

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setStatus('idle');

        // Client-side rate limiting: 60-second cooldown between submissions
        const lastSubmission = localStorage.getItem('relu_contact_last_sent');
        if (lastSubmission) {
            const elapsed = Date.now() - parseInt(lastSubmission, 10);
            if (elapsed < 60000) {
                const remaining = Math.ceil((60000 - elapsed) / 1000);
                setErrorMessage(`Please wait ${remaining}s before sending another message.`);
                setStatus('error');
                setLoading(false);
                return;
            }
        }

        // Field length validation
        if (formData.name.length > 100 || formData.subject.length > 200 || formData.message.length > 2000) {
            setErrorMessage("Your message exceeds the allowed length (name ≤ 100, subject ≤ 200, message ≤ 2000 characters).");
            setStatus('error');
            setLoading(false);
            return;
        }

        try {
            await saveMessage(formData);
            localStorage.setItem('relu_contact_last_sent', Date.now().toString());
            setStatus('success');
            setFormData({ name: "", email: "", subject: "", message: "" });
        } catch (error) {
            console.error(error);
            setErrorMessage("Failed to send message. Please try again later.");
            setStatus('error');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen pt-32 md:pt-36 pb-20 px-4">
            <div className="max-w-6xl mx-auto">
                {/* Header */}
                <div className="text-center mb-16 animate-in slide-in-from-bottom-5">
                    <h1 className="text-4xl md:text-6xl font-black mb-6 bg-clip-text text-transparent bg-gradient-to-r from-blue-400 via-purple-500 to-pink-500">
                        Get in Touch
                    </h1>
                    <p className="text-xl text-gray-400 max-w-2xl mx-auto leading-relaxed">
                        Questions about events, workshops or joining the club? Send us a message below or email us directly.
                    </p>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-24">
                    {/* Contact Info */}
                    <div className="space-y-12 animate-in slide-in-from-left-5 delay-100">
                        {/* Info Cards */}
                        <div className="space-y-6">
                            <div className="flex items-start gap-6 p-6 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 transition-colors group">
                                <div className="w-12 h-12 bg-blue-500/20 rounded-xl flex items-center justify-center text-blue-400 group-hover:scale-110 transition-transform">
                                    <Mail size={24} />
                                </div>
                                <div>
                                    <h3 className="text-xl font-bold text-white mb-1">Email Us</h3>
                                    <p className="text-gray-400 mb-2">For general inquiries and support</p>
                                    <div className="flex flex-col gap-1">
                                        <a href="mailto:reluavv@gmail.com" className="text-blue-400 hover:text-blue-300 font-mono">reluavv@gmail.com</a>
                                        <a href="mailto:reluclub@av.amrita.edu" className="text-blue-400 hover:text-blue-300 font-mono">reluclub@av.amrita.edu</a>
                                    </div>
                                </div>
                            </div>

                            <div className="flex items-start gap-6 p-6 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 transition-colors group">
                                <div className="w-12 h-12 bg-purple-500/20 rounded-xl flex items-center justify-center text-purple-400 group-hover:scale-110 transition-transform">
                                    <MapPin size={24} />
                                </div>
                                <div>
                                    <h3 className="text-xl font-bold text-white mb-1">Visit Us</h3>
                                    <p className="text-gray-400">
                                        ReLU, Technical Club<br />
                                        Amrita Vishwa Vidyapeetham<br />
                                        Amaravathi Campus<br />
                                        Andhra Pradesh, India
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Sign-up prompt */}
                        <div className="p-8 rounded-3xl bg-gradient-to-br from-blue-900/20 to-purple-900/20 border border-white/10">
                            <h3 className="text-2xl font-bold text-white mb-4">Join the Community</h3>
                            <p className="text-gray-400 mb-6">
                                Create an account with your college email to register for events and workshops.
                            </p>
                            <a
                                href="/auth/signup"
                                className="inline-flex items-center gap-2 text-white font-bold bg-white/10 hover:bg-white/20 px-4 py-2 rounded-lg transition-colors"
                            >
                                Get Started <ArrowRight size={16} />
                            </a>
                        </div>
                    </div>

                    {/* Contact Form */}
                    <div className="bg-white/5 border border-white/10 rounded-3xl p-8 lg:p-10 animate-in slide-in-from-right-5 delay-200 backdrop-blur-sm relative overflow-hidden">

                        {/* Status Overlays */}
                        {status === 'success' && (
                            <div className="absolute inset-0 bg-black/90 z-20 flex flex-col items-center justify-center text-center p-8 animate-in fade-in zoom-in">
                                <CheckCircle size={64} className="text-green-500 mb-6" />
                                <h3 className="text-2xl font-bold text-white mb-2">Message Sent!</h3>
                                <p className="text-gray-400 mb-8">We&apos;ve received your message and will get back to you shortly.</p>
                                <button
                                    onClick={() => setStatus('idle')}
                                    className="px-6 py-2 bg-white/10 hover:bg-white/20 rounded-full text-white font-bold transition-colors"
                                >
                                    Send Another
                                </button>
                            </div>
                        )}

                        <form onSubmit={handleSubmit} className="space-y-6 relative z-10">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="space-y-2">
                                    <label htmlFor="contact-name" className="text-sm font-bold text-gray-400 uppercase tracking-wider">Name</label>
                                    <input
                                        id="contact-name"
                                        type="text"
                                        required
                                        maxLength={100}
                                        className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all placeholder:text-gray-600"
                                        placeholder="John Doe"
                                        value={formData.name}
                                        onChange={e => setFormData({ ...formData, name: e.target.value })}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label htmlFor="contact-email" className="text-sm font-bold text-gray-400 uppercase tracking-wider">Email</label>
                                    <input
                                        id="contact-email"
                                        type="email"
                                        required
                                        className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all placeholder:text-gray-600"
                                        placeholder="john@example.com"
                                        value={formData.email}
                                        onChange={e => setFormData({ ...formData, email: e.target.value })}
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <label htmlFor="contact-subject" className="text-sm font-bold text-gray-400 uppercase tracking-wider">Subject</label>
                                <input
                                    id="contact-subject"
                                    type="text"
                                    required
                                    maxLength={200}
                                    className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all placeholder:text-gray-600"
                                    placeholder="What's this about?"
                                    value={formData.subject}
                                    onChange={e => setFormData({ ...formData, subject: e.target.value })}
                                />
                            </div>

                            <div className="space-y-2">
                                <label htmlFor="contact-message" className="text-sm font-bold text-gray-400 uppercase tracking-wider">Message</label>
                                <textarea
                                    id="contact-message"
                                    required
                                    rows={5}
                                    maxLength={2000}
                                    className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all placeholder:text-gray-600 resize-none"
                                    placeholder="Tell us about it..."
                                    value={formData.message}
                                    onChange={e => setFormData({ ...formData, message: e.target.value })}
                                />
                            </div>

                            {status === 'error' && (
                                <div role="alert" className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl flex items-center gap-3 text-red-400 text-sm">
                                    <AlertCircle size={18} className="shrink-0" />
                                    {errorMessage}
                                </div>
                            )}

                            <button
                                type="submit"
                                disabled={loading}
                                className="w-full py-4 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white font-bold rounded-xl transition-all shadow-lg shadow-blue-900/20 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed group"
                            >
                                {loading ? (
                                    <Loader2 className="animate-spin" />
                                ) : (
                                    <>
                                        Send Message <Send size={18} className="group-hover:translate-x-1 transition-transform" />
                                    </>
                                )}
                            </button>
                        </form>
                    </div>
                </div>
            </div>
        </div>
    );
}
