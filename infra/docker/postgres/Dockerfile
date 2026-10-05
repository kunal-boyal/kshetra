# Local PostgreSQL matching Amazon RDS (spec 9.2): PostgreSQL 18 with PostGIS and pg_partman.
# Both come from the PostgreSQL apt repository, which builds for Intel and Apple silicon; the
# postgis/postgis images are Intel-only. pg_trgm ships with PostgreSQL itself.
FROM postgres:18

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    postgresql-18-postgis-3 \
    postgresql-18-postgis-3-scripts \
    postgresql-18-partman \
  && rm -rf /var/lib/apt/lists/*
