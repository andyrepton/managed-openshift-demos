# Create a Global Accelerator across two ROSA clusters. See README for more info

# Group 1
resource "aws_globalaccelerator_endpoint_group" "rosa-1" {
  provider = aws.west
  listener_arn = aws_globalaccelerator_listener.rosa-multi-region.id

  endpoint_configuration {
    endpoint_id = var.rosa_1_nlb
    weight      = 100
  }
}

# Group 2
resource "aws_globalaccelerator_endpoint_group" "rosa-2" {
  provider = aws.central
  listener_arn = aws_globalaccelerator_listener.rosa-multi-region.id

  endpoint_configuration {
    endpoint_id = var.rosa_2_nlb
    weight      = 100
  }
}

resource "aws_globalaccelerator_accelerator" "rosa-multi-region" {
  name            = "ROSA-Accelerator"
  ip_address_type = "IPV4"
  enabled         = true
}

resource "aws_globalaccelerator_listener" "rosa-multi-region" {
  accelerator_arn = aws_globalaccelerator_accelerator.rosa-multi-region.id
  client_affinity = "NONE"
  protocol        = "TCP"

  port_range {
    from_port = 80
    to_port   = 443
  }
}
