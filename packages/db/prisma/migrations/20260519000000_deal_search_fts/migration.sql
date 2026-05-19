-- Full-text + trigram search over canonical deals (shared cache).

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE "deal_search_index" (
    "canonical_id" TEXT NOT NULL,
    "adapters" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "title" TEXT,
    "location" TEXT,
    "document" TEXT NOT NULL,
    "search_vector" tsvector,

    CONSTRAINT "deal_search_index_pkey" PRIMARY KEY ("canonical_id")
);

CREATE INDEX "deal_search_index_vector_idx"
    ON "deal_search_index" USING GIN ("search_vector");

CREATE INDEX "deal_search_index_title_trgm_idx"
    ON "deal_search_index" USING GIN ("title" gin_trgm_ops);

CREATE INDEX "deal_search_index_location_trgm_idx"
    ON "deal_search_index" USING GIN ("location" gin_trgm_ops);

CREATE OR REPLACE FUNCTION deal_search_index_tsvector_update() RETURNS trigger AS $$
BEGIN
    NEW.search_vector :=
        setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(NEW.location, '')), 'B') ||
        setweight(to_tsvector('english', coalesce(NEW.document, '')), 'C') ||
        setweight(to_tsvector('simple', array_to_string(NEW.adapters, ' ')), 'D');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER deal_search_index_tsvector_trigger
    BEFORE INSERT OR UPDATE OF title, location, document, adapters
    ON "deal_search_index"
    FOR EACH ROW
    EXECUTE FUNCTION deal_search_index_tsvector_update();
