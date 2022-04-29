---
author: julferts@d2iq.com
title: Share Bootstrap Cluster using EKS
date: 2022-06-01
draft: true
---

Deploying cluster with DKP is easy but in common production environments the Cluster must fit into the existing ecosystem respecting permissions and user-roles, dealing with docker registry authentication or using a special certificate issuer.

This is the starting post of a series of blog posts about how we maintain our "production" ( we're counting our long running test systems into production ) clusters and how do we automate their lifecycle.

# DKP Bootstrap
The bootstrapping process is very simple nowadays using DKP. When using the `--self-managed` flag[^1] no further user interaction is needed to spin up the cluster and move capi-controllers into it so it maintains itself.
Like everything this comes with a slight draw-back. Depending on the size of the cluster and the operators connection to AWS this could take quite some time. In nowadays post-pandemic work-from-home environments it also relies on the operators internet connection which might not be very reliable, depending on the type of connection or location. Furthermore also some minor security drawbacks come with this solution as during the bootstrap process DKP impersonates the user and is acting in his name until the cluster controllers got finally moved to the created cluster. This means the operator needs at least the same privileges as the cluster.

All this is actually not too important when just a buch of small clusters for development and test cases being spawned but it is getting quite serious when dealing with large clusters in huge environments with different departments involved.

So in this post we'll talk about a bit more complex but therefore way more flexible solution - using EKS as bootstrap clusters.

# AWS EKS[^2]
Is an AWS service that offers managed Kubernetes Control-Plane and Worker pools. From DKP perspective it is pretty similar to the KIND[^3] cluster which is build into dkp-cli despite the fact that the worker pools runs already in AWS and therefore does not have any connection limitation and also is able to use the same instance profiles as the to be spawned DKP cluster will use.

This gives the opportunity having one team ( e.g. the Cloud Department ) standing up the IAM Policy part for DKP as well as preparing a simple EKS cluster with a single node node-pool using those policies where another department is the DKP user and does not need any other permission to AWS than connecting to the EKS cluster.

# Preparation
For this example we'll use Terraform[^4] to create and maintain the IAM Instance Profiles, Roles and Policies as well as the EKS Cluster and a single node node-pool using the DKP Policies[^5]. Whatever is done with terraform will be the Tasks done be the secondary Department; We'll all them CloudOps for now.

Be aware that AWS IAM Resources are Account Global so their name is being unique for a single account but is available in every region. We'll add the clusters name to the policies we're creating to avoid any conflict when multiple management clusters are being spawned into a single AWS account. Also we're adding tags to all the resources we're creating.

to do so we're using Terraform variables.

```hcl
locals {
  cluster_name = "testdkp22"
  tags = {
    owner       = "julferts"
    expiration  = "36h"
  }
}
```

## AWS IAM Policies

### Control Plane
```hcl
data "aws_iam_policy_document" "control-plane-policy-document" {
  statement {
    sid = "1"

    actions = [
      "autoscaling:DescribeAutoScalingGroups",
      "autoscaling:DescribeLaunchConfigurations",
      "autoscaling:DescribeTags",
      "ec2:DescribeInstances",
      "ec2:DescribeImages",
      "ec2:DescribeRegions",
      "ec2:DescribeRouteTables",
      "ec2:DescribeSecurityGroups",
      "ec2:DescribeSubnets",
      "ec2:DescribeVolumes",
      "ec2:CreateSecurityGroup",
      "ec2:CreateTags",
      "ec2:CreateVolume",
      "ec2:ModifyInstanceAttribute",
      "ec2:ModifyVolume",
      "ec2:AttachVolume",
      "ec2:AuthorizeSecurityGroupIngress",
      "ec2:CreateRoute",
      "ec2:DeleteRoute",
      "ec2:DeleteSecurityGroup",
      "ec2:DeleteVolume",
      "ec2:DetachVolume",
      "ec2:RevokeSecurityGroupIngress",
      "ec2:DescribeVpcs",
      "elasticloadbalancing:AddTags",
      "elasticloadbalancing:AttachLoadBalancerToSubnets",
      "elasticloadbalancing:ApplySecurityGroupsToLoadBalancer",
      "elasticloadbalancing:CreateLoadBalancer",
      "elasticloadbalancing:CreateLoadBalancerPolicy",
      "elasticloadbalancing:CreateLoadBalancerListeners",
      "elasticloadbalancing:ConfigureHealthCheck",
      "elasticloadbalancing:DeleteLoadBalancer",
      "elasticloadbalancing:DeleteLoadBalancerListeners",
      "elasticloadbalancing:DescribeLoadBalancers",
      "elasticloadbalancing:DescribeLoadBalancerAttributes",
      "elasticloadbalancing:DetachLoadBalancerFromSubnets",
      "elasticloadbalancing:DeregisterInstancesFromLoadBalancer",
      "elasticloadbalancing:ModifyLoadBalancerAttributes",
      "elasticloadbalancing:RegisterInstancesWithLoadBalancer",
      "elasticloadbalancing:SetLoadBalancerPoliciesForBackendServer",
      "elasticloadbalancing:AddTags",
      "elasticloadbalancing:CreateListener",
      "elasticloadbalancing:CreateTargetGroup",
      "elasticloadbalancing:DeleteListener",
      "elasticloadbalancing:DeleteTargetGroup",
      "elasticloadbalancing:DescribeListeners",
      "elasticloadbalancing:DescribeLoadBalancerPolicies",
      "elasticloadbalancing:DescribeTargetGroups",
      "elasticloadbalancing:DescribeTargetHealth",
      "elasticloadbalancing:ModifyListener",
      "elasticloadbalancing:ModifyTargetGroup",
      "elasticloadbalancing:RegisterTargets",
      "elasticloadbalancing:SetLoadBalancerPoliciesOfListener",
      "iam:CreateServiceLinkedRole",
      "kms:DescribeKey"
    ]

    resources = [
      "*"
    ]
  }
}

resource "aws_iam_policy" "control-plane-policy" {
  name   = "${local.cluster_name}.control-plane.cluster-api-provider-aws.sigs.k8s.io"
  path   = "/"
  policy = data.aws_iam_policy_document.control-plane-policy-document.json
  tags   = local.tags
}

data "aws_iam_policy_document" "controllers-cluster-api-policy-document" {
  statement {

    actions = [
      "ec2:AllocateAddress",
      "ec2:AssociateRouteTable",
      "ec2:AttachInternetGateway",
      "ec2:AuthorizeSecurityGroupIngress",
      "ec2:CreateInternetGateway",
      "ec2:CreateNatGateway",
      "ec2:CreateRoute",
      "ec2:CreateRouteTable",
      "ec2:CreateSecurityGroup",
      "ec2:CreateSubnet",
      "ec2:CreateTags",
      "ec2:CreateVpc",
      "ec2:ModifyVpcAttribute",
      "ec2:DeleteInternetGateway",
      "ec2:DeleteNatGateway",
      "ec2:DeleteRouteTable",
      "ec2:DeleteSecurityGroup",
      "ec2:DeleteSubnet",
      "ec2:DeleteTags",
      "ec2:DeleteVpc",
      "ec2:DescribeAccountAttributes",
      "ec2:DescribeAddresses",
      "ec2:DescribeAvailabilityZones",
      "ec2:DescribeInstances",
      "ec2:DescribeInternetGateways",
      "ec2:DescribeImages",
      "ec2:DescribeNatGateways",
      "ec2:DescribeNetworkInterfaces",
      "ec2:DescribeNetworkInterfaceAttribute",
      "ec2:DescribeRouteTables",
      "ec2:DescribeSecurityGroups",
      "ec2:DescribeSubnets",
      "ec2:DescribeVpcs",
      "ec2:DescribeVpcAttribute",
      "ec2:DescribeVolumes",
      "ec2:DetachInternetGateway",
      "ec2:DisassociateRouteTable",
      "ec2:DisassociateAddress",
      "ec2:ModifyInstanceAttribute",
      "ec2:ModifyNetworkInterfaceAttribute",
      "ec2:ModifySubnetAttribute",
      "ec2:ReleaseAddress",
      "ec2:RevokeSecurityGroupIngress",
      "ec2:RunInstances",
      "ec2:TerminateInstances",
      "tag:GetResources",
      "elasticloadbalancing:AddTags",
      "elasticloadbalancing:CreateLoadBalancer",
      "elasticloadbalancing:ConfigureHealthCheck",
      "elasticloadbalancing:DeleteLoadBalancer",
      "elasticloadbalancing:DescribeLoadBalancers",
      "elasticloadbalancing:DescribeLoadBalancerAttributes",
      "elasticloadbalancing:ApplySecurityGroupsToLoadBalancer",
      "elasticloadbalancing:DescribeTags",
      "elasticloadbalancing:ModifyLoadBalancerAttributes",
      "elasticloadbalancing:RegisterInstancesWithLoadBalancer",
      "elasticloadbalancing:DeregisterInstancesFromLoadBalancer",
      "elasticloadbalancing:RemoveTags",
      "autoscaling:DescribeAutoScalingGroups",
      "autoscaling:DescribeInstanceRefreshes",
      "ec2:CreateLaunchTemplate",
      "ec2:CreateLaunchTemplateVersion",
      "ec2:DescribeLaunchTemplates",
      "ec2:DescribeLaunchTemplateVersions",
      "ec2:DeleteLaunchTemplate",
      "ec2:DeleteLaunchTemplateVersions",
      "route53:ChangeResourceRecordSets",
      "route53:ListHostedZones",
      "route53:ListResourceRecordSets"
    ]

    resources = [
      "*"
    ]
  }

  statement {
    actions = [
      "autoscaling:CreateAutoScalingGroup",
      "autoscaling:UpdateAutoScalingGroup",
      "autoscaling:CreateOrUpdateTags",
      "autoscaling:StartInstanceRefresh",
      "autoscaling:DeleteAutoScalingGroup",
      "autoscaling:DeleteTags"
    ]
    resources = [
      "arn:*:autoscaling:*:*:autoScalingGroup:*:autoScalingGroupName/*"
    ]
  }

  statement {
    actions = [
      "iam:CreateServiceLinkedRole"
    ]

    condition {
      test     = "StringLike"
      variable = "iam:AWSServiceName"

      values = [
        "autoscaling.amazonaws.com"
      ]
    }
    resources = [
      "arn:*:iam::*:role/aws-service-role/autoscaling.amazonaws.com/AWSServiceRoleForAutoScaling"
    ]
  }

  statement {
    actions = [
      "iam:CreateServiceLinkedRole"
    ]

    condition {
      test     = "StringLike"
      variable = "iam:AWSServiceName"

      values = [
        "spot.amazonaws.com"
      ]
    }
    resources = [
      "arn:*:iam::*:role/aws-service-role/spot.amazonaws.com/AWSServiceRoleForEC2Spot"
    ]
  }

  statement {
    actions = [
      "iam:CreateServiceLinkedRole"
    ]

    condition {
      test     = "StringLike"
      variable = "iam:AWSServiceName"

      values = [
        "elasticloadbalancing.amazonaws.com"
      ]
    }
    resources = [
      "arn:*:iam::*:role/aws-service-role/elasticloadbalancing.amazonaws.com/AWSServiceRoleForElasticLoadBalancing"
    ]
  }

  statement {
    actions = [
      "iam:PassRole"
    ]
    resources = [
      "arn:*:iam::*:role/*.cluster-api-provider-aws.sigs.k8s.io"
    ]
  }

  statement {
    actions = [
      "secretsmanager:CreateSecret",
      "secretsmanager:DeleteSecret",
      "secretsmanager:TagResource"
    ]
    resources = [
      "arn:*:secretsmanager:*:*:secret:aws.cluster.x-k8s.io/*"
    ]
  }
}

resource "aws_iam_policy" "controllers-cluster-api-policy" {
  name   = "${local.cluster_name}.controllers.cluster-api-provider-aws.sigs.k8s.io"
  path   = "/"
  policy = data.aws_iam_policy_document.controllers-cluster-api-policy-document.json
  tags   = local.tags
}
```

### Worker Nodes

```hcl
data "aws_iam_policy_document" "nodes-policy-document" {
  statement {
    actions = [
      "ec2:DescribeInstances",
      "ec2:DescribeRegions",
      "ecr:GetAuthorizationToken",
      "ecr:BatchCheckLayerAvailability",
      "ecr:GetDownloadUrlForLayer",
      "ecr:GetRepositoryPolicy",
      "ecr:DescribeRepositories",
      "ecr:ListImages",
      "ecr:BatchGetImage",
      "ssm:UpdateInstanceInformation",
      "ssmmessages:CreateControlChannel",
      "ssmmessages:CreateDataChannel",
      "ssmmessages:OpenControlChannel",
      "ssmmessages:OpenDataChannel",
      "s3:GetEncryptionConfiguration",
      "route53:ChangeResourceRecordSets",
      "route53:ListHostedZones",
      "route53:ListResourceRecordSets"
    ]

    resources = [
      "*"
    ]
  }

  statement {
    actions = [
      "secretsmanager:DeleteSecret",
      "secretsmanager:GetSecretValue"
    ]

    resources = [
      "arn:*:secretsmanager:*:*:secret:aws.cluster.x-k8s.io/*"
    ]
  }

  # add DNS challenge permissions
  statement {
    actions = [
      "route53:GetChange"
    ]

    resources = [
      "arn:aws:route53:::change/*"
    ]
  }

  statement {
    actions = [
      "route53:ChangeResourceRecordSets",
      "route53:ListResourceRecordSets"
    ]

    resources = [
      "arn:aws:route53:::hostedzone/*"
    ]
  }

  statement {
    actions = [
      "route53:ListHostedZonesByName"
    ]

    resources = [
      "*"
    ]
  }
}

resource "aws_iam_policy" "nodes-policy" {
  name   = "${local.cluster_name}.nodes.cluster-api-provider-aws.sigs.k8s.io"
  path   = "/"
  tags   = local.tags
  policy = data.aws_iam_policy_document.nodes-policy-document.json
}
```

## Roles and Instance profiles
The roles and instance profiles are exactly the same as in the DKP documentation[^5] but we'll need to create an additional role using the control-plane policy for DKP which will be used by AWS EKS node-pool.

### Control Plane and Worker Nodes

```hcl
resource "aws_iam_role" "control-plane-role" {
  name = "${local.cluster_name}.control-plane.cluster-api-provider-aws.sigs.k8s.io"
  path = "/"
  tags = local.tags

  assume_role_policy = <<EOF
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Action": "sts:AssumeRole",
            "Principal": {
               "Service": "ec2.amazonaws.com"
            },
            "Effect": "Allow",

            "Sid": ""
        }
    ]
}
EOF
}

resource "aws_iam_role_policy_attachment" "control-plane-role-attachment" {
  role       = aws_iam_role.control-plane-role.name
  policy_arn = aws_iam_policy.control-plane-policy.arn
}

resource "aws_iam_role_policy_attachment" "control-plane-cluster-api-controllers-role-attachment" {
  role       = aws_iam_role.control-plane-role.name
  policy_arn = aws_iam_policy.controllers-cluster-api-policy.arn
}

resource "aws_iam_role_policy_attachment" "control-plane-node-role-attachment" {
  role       = aws_iam_role.control-plane-role.name
  policy_arn = aws_iam_policy.nodes-policy.arn
}

resource "aws_iam_instance_profile" "control-plane-instance-profile" {
  name = "${local.cluster_name}.control-plane.cluster-api-provider-aws.sigs.k8s.io"
  role = aws_iam_role.control-plane-role.name
  tags = local.tags
}

resource "aws_iam_role" "nodes-role" {
  name = "${local.cluster_name}.nodes.cluster-api-provider-aws.sigs.k8s.io"
  path = "/"
  tags = local.tags

  assume_role_policy = <<EOF
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Action": "sts:AssumeRole",
            "Principal": {
               "Service": "ec2.amazonaws.com"
            },
            "Effect": "Allow",
            "Sid": ""
        }
    ]
}
EOF
}

resource "aws_iam_role_policy_attachment" "nodes-role-attachment" {
  role       = aws_iam_role.nodes-role.name
  policy_arn = aws_iam_policy.nodes-policy.arn
}

resource "aws_iam_instance_profile" "nodes-instance-profile" {
  name = "${local.cluster_name}.nodes.cluster-api-provider-aws.sigs.k8s.io"
  role = aws_iam_role.nodes-role.name
  tags = local.tags
}
```

### Special Case: EKS Policies
For EKS the role gets not only the above defined control-plane policies assigned but also the specific EKS policies needed internally by EKS node polls.

```hcl
resource "aws_iam_role" "dkp-eks-role" {
  name = "${local.cluster_name}.dkp-eks.cluster-api-provider-aws.sigs.k8s.io"
  path = "/"
  tags = local.tags

  assume_role_policy = <<EOF
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Action": "sts:AssumeRole",
            "Principal": {
               "Service": "ec2.amazonaws.com"
            },
            "Effect": "Allow",

            "Sid": ""
        },{
          "Effect": "Allow",
          "Principal": {
            "Service": "eks.amazonaws.com"
          },
          "Action": "sts:AssumeRole"
        },{
        "Effect": "Allow",
        "Principal": {
          "Service": "eks-fargate-pods.amazonaws.com"
        },
        "Action": "sts:AssumeRole"
      }
    ]
}
EOF
}

resource "aws_iam_role_policy_attachment" "dkp-eks-role-attachment" {
  role       = aws_iam_role.dkp-eks-role.name
  policy_arn = aws_iam_policy.control-plane-policy.arn
}

resource "aws_iam_role_policy_attachment" "control-plane-cluster-api-controllers-role-attachment" {
  role       = aws_iam_role.dkp-eks-role.name
  policy_arn = aws_iam_policy.controllers-cluster-api-policy.arn
}

resource "aws_iam_role_policy_attachment" "control-plane-node-role-attachment" {
  role       = aws_iam_role.dkp-eks-role.name
  policy_arn = aws_iam_policy.nodes-policy.arn
}

resource "aws_iam_role_policy_attachment" "control-plane-eks-role-attachment" {
  role       = aws_iam_role.dkp-eks-role.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSClusterPolicy"
}

resource "aws_iam_role_policy_attachment" "control-plane-eks-node-role-attachment" {
  role       = aws_iam_role.dkp-eks-role.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy"
}

resource "aws_iam_role_policy_attachment" "control-plane-eks-ecr-role-attachment" {
  role       = aws_iam_role.dkp-eks-role.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
}

resource "aws_iam_role_policy_attachment" "control-plane-eks-rc-role-attachment" {
  role       = aws_iam_role.dkp-eks-role.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSVPCResourceController"
}

resource "aws_iam_role_policy_attachment" "control-plane-eks-cloudwatch-role-attachment" {
  role       = aws_iam_role.dkp-eks-role.name
  policy_arn = "arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy"
}

resource "aws_iam_instance_profile" "control-plane-eks-instance-profile" {
  name = "${local.cluster_name}.dkp-eks.cluster-api-provider-aws.sigs.k8s.io"
  role = aws_iam_role.dkp-eks-role.name
  tags = local.tags
}
```


[^1]: https://docs.d2iq.com/dkp/konvoy/2.2/cli/dkp/create/cluster/aws/
[^2]: https://aws.amazon.com/eks/
[^3]: https://kind.sigs.k8s.io/docs/user/quick-start/
[^4]: https://www.terraform.io/
[^5]: https://docs.d2iq.com/dkp/konvoy/2.2/choose-infrastructure/aws/iam-policies/
