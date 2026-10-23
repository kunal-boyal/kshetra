-- Orders carry the writing transaction's ID, as other synced rows do (decisions D40 and D78), so
-- phones keep the orders their person placed and where each one stands.
CREATE TRIGGER "orders_row_version" BEFORE UPDATE ON "cell"."orders"
  FOR EACH ROW EXECUTE FUNCTION "cell"."next_row_version"();
