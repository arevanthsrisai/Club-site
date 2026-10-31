FROM node:22-alpine AS base

# ── DEPS stage ──
FROM base AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json ./
RUN npm ci

# ── BUILD stage ──
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Pass public Firebase config at build time (safe to embed; these ship to browsers anyway)
ARG NEXT_PUBLIC_FIREBASE_API_KEY
ARG NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
ARG NEXT_PUBLIC_FIREBASE_PROJECT_ID
ARG NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
ARG NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
ARG NEXT_PUBLIC_FIREBASE_APP_ID
ARG NEXT_PUBLIC_FIRESTORE_DATABASE_ID

ENV NEXT_PUBLIC_FIREBASE_API_KEY=$NEXT_PUBLIC_FIREBASE_API_KEY
ENV NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=$NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
ENV NEXT_PUBLIC_FIREBASE_PROJECT_ID=$NEXT_PUBLIC_FIREBASE_PROJECT_ID
ENV NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=$NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
ENV NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=$NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
ENV NEXT_PUBLIC_FIREBASE_APP_ID=$NEXT_PUBLIC_FIREBASE_APP_ID
ENV NEXT_PUBLIC_FIRESTORE_DATABASE_ID=$NEXT_PUBLIC_FIRESTORE_DATABASE_ID

# Build-time validation: fail the build if the Firestore database ID is missing.
# This prevents a silently broken browser bundle that throws at runtime.
RUN if [ -z "$NEXT_PUBLIC_FIRESTORE_DATABASE_ID" ]; then \
        echo "ERROR: NEXT_PUBLIC_FIRESTORE_DATABASE_ID is required for the build." >&2; \
        echo "       Pass it as --build-arg NEXT_PUBLIC_FIRESTORE_DATABASE_ID=<id>" >&2; \
        echo "       (e.g. (default) for production, default-clone for local dev)" >&2; \
        exit 1; \
    fi

RUN npm run build

# ── RUNNER stage ──
FROM base AS runner
WORKDIR /app

ENV NODE_ENV production
ENV NEXT_TELEMETRY_DISABLED 1
ENV PORT 3000

# Create non-root user (Cloud Run best practice)
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy only the standalone server bundle + static assets
COPY --from=builder /app/public ./public
RUN mkdir .next && chown nextjs:nodejs .next
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

# The Next.js standalone server.js binds to 0.0.0.0; Cloud Run sets PORT automatically.
CMD ["node", "server.js"]