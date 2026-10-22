output "vpc_id" {
  value = aws_vpc.this.id
}

output "cidr" {
  value = var.cidr
}

output "public_subnet_ids" {
  value = [for key in ["public-0", "public-1"] : aws_subnet.this[key].id]
}

output "private_subnet_ids" {
  value = [for key in ["private-0", "private-1"] : aws_subnet.this[key].id]
}

output "database_subnet_ids" {
  value = [for key in ["database-0", "database-1"] : aws_subnet.this[key].id]
}
