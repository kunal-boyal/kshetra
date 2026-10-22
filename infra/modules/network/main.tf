# A cell's network (spec 14.2): a VPC across two zones with public, private and database subnets,
# NAT for the tasks' outbound calls (MSG91, Expo push, SES) and a gateway endpoint for S3.

locals {
  tiers = { public = 0, private = 1, database = 2 }
  # Each zone gets a /20 in each tier: 3 tiers × 2 zones of a /16.
  subnets = {
    for pair in setproduct(keys(local.tiers), range(2)) :
    "${pair[0]}-${pair[1]}" => {
      tier = pair[0]
      zone = var.zones[pair[1]]
      cidr = cidrsubnet(var.cidr, 4, local.tiers[pair[0]] * 2 + pair[1])
    }
  }
}

resource "aws_vpc" "this" {
  cidr_block           = var.cidr
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = merge(var.tags, { Name = var.name })
}

resource "aws_subnet" "this" {
  for_each                = local.subnets
  vpc_id                  = aws_vpc.this.id
  cidr_block              = each.value.cidr
  availability_zone       = each.value.zone
  map_public_ip_on_launch = each.value.tier == "public"
  tags                    = merge(var.tags, { Name = "${var.name}-${each.key}", Tier = each.value.tier })
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id
  tags   = merge(var.tags, { Name = var.name })
}

resource "aws_eip" "nat" {
  count  = var.nat_per_zone ? 2 : 1
  domain = "vpc"
  tags   = merge(var.tags, { Name = "${var.name}-nat-${count.index}" })
}

resource "aws_nat_gateway" "this" {
  count         = var.nat_per_zone ? 2 : 1
  allocation_id = aws_eip.nat[count.index].id
  subnet_id     = aws_subnet.this["public-${count.index}"].id
  tags          = merge(var.tags, { Name = "${var.name}-${count.index}" })
  depends_on    = [aws_internet_gateway.this]
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.this.id
  }
  tags = merge(var.tags, { Name = "${var.name}-public" })
}

resource "aws_route_table" "private" {
  count  = 2
  vpc_id = aws_vpc.this.id
  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.this[var.nat_per_zone ? count.index : 0].id
  }
  tags = merge(var.tags, { Name = "${var.name}-private-${count.index}" })
}

# The database tier has no route out at all.
resource "aws_route_table" "database" {
  vpc_id = aws_vpc.this.id
  tags   = merge(var.tags, { Name = "${var.name}-database" })
}

resource "aws_route_table_association" "this" {
  for_each  = local.subnets
  subnet_id = aws_subnet.this[each.key].id
  route_table_id = (
    each.value.tier == "public" ? aws_route_table.public.id :
    each.value.tier == "private" ? aws_route_table.private[tonumber(substr(each.key, -1, 1))].id :
    aws_route_table.database.id
  )
}

data "aws_region" "current" {}

resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.this.id
  service_name      = "com.amazonaws.${data.aws_region.current.region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = aws_route_table.private[*].id
  tags              = merge(var.tags, { Name = "${var.name}-s3" })
}

resource "aws_security_group" "endpoints" {
  count       = var.interface_endpoints ? 1 : 0
  name        = "${var.name}-endpoints"
  description = "Private endpoints, reached from inside the VPC"
  vpc_id      = aws_vpc.this.id
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = [var.cidr]
  }
  tags = var.tags
}

resource "aws_vpc_endpoint" "interface" {
  for_each            = var.interface_endpoints ? toset(["ecr.api", "ecr.dkr", "secretsmanager", "logs"]) : toset([])
  vpc_id              = aws_vpc.this.id
  service_name        = "com.amazonaws.${data.aws_region.current.region}.${each.key}"
  vpc_endpoint_type   = "Interface"
  private_dns_enabled = true
  subnet_ids          = [for key, subnet in local.subnets : aws_subnet.this[key].id if subnet.tier == "private"]
  security_group_ids  = [aws_security_group.endpoints[0].id]
  tags                = merge(var.tags, { Name = "${var.name}-${each.key}" })
}
