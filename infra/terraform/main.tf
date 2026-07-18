provider "hcloud" {
  token = var.hcloud_token != "" ? var.hcloud_token : null
}

locals {
  app_host = "${var.hostname}.${var.domain}"
  managed_ssh_key_name = var.managed_ssh_key_name != "" ? var.managed_ssh_key_name : "${var.project_name}-deploy-key"
  server_ssh_keys      = concat(var.hcloud_ssh_keys, hcloud_ssh_key.managed[*].id)
}

resource "hcloud_firewall" "web" {
  name = "${var.project_name}-fw"

  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "22"
    source_ips = var.ssh_allowed_cidrs
  }

  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "80"
    source_ips = ["0.0.0.0/0", "::/0"]
  }

  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "443"
    source_ips = ["0.0.0.0/0", "::/0"]
  }
}

resource "hcloud_server" "app" {
  name        = "${var.project_name}-app"
  server_type = var.server_type
  image       = var.server_image
  location    = var.location
  ssh_keys    = local.server_ssh_keys
  firewall_ids = [hcloud_firewall.web.id]

  user_data = templatefile("${path.module}/user_data.sh.tftpl", {
    project_name = var.project_name
  })
}

resource "hcloud_ssh_key" "managed" {
  count      = var.managed_ssh_public_key != "" ? 1 : 0
  name       = local.managed_ssh_key_name
  public_key = var.managed_ssh_public_key
}
