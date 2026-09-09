# Test Scenario: Reproduce JSON Parsing Errors

This document provides a reproducible test case for the JSON parsing error reported by tvaughan.

## Prerequisites

- Claude Code connected to the cluster via LiteLLM
- Monitoring script running (`./scripts/monitor-json-errors.sh`)
- Qwen model is deployed and ready

## Setup

1. **Start monitoring in a separate terminal:**
```bash
cd /Users/arepton/git/andyrepton/managed-openshift-demos/demo-claude-via-open-source-models
./scripts/monitor-json-errors.sh
```

2. **Connect Claude Code:**
```bash
export ANTHROPIC_BASE_URL="https://$(oc get route litellm-gateway -n claude-code-demo -o jsonpath='{.spec.host}')"
export ANTHROPIC_API_KEY="$(oc get secret litellm-api-key -n claude-code-demo -o jsonpath='{.data.master-key}' | base64 -d)"
claude
```

3. **Verify connection:**
```
/status
/model qwen3-6-27b
```

## Test Case 1: Large TODO List (Original Issue)

Create `/tmp/complex-remediation.py`:

```python
"""
Complex AWS Infrastructure Remediation Task

TODO:
1. Analyze this Lambda function for security vulnerabilities
2. Check IAM role permissions for least privilege
3. Review VPC configuration for network isolation
4. Audit CloudWatch logs retention and access
5. Verify encryption at rest and in transit
6. Check for hardcoded credentials or secrets
7. Review error handling and retry logic
8. Analyze cost optimization opportunities
9. Check for unused or orphaned resources
10. Review API Gateway throttling configuration
11. Audit DynamoDB table provisioning
12. Check S3 bucket policies and ACLs
13. Review KMS key rotation policies
14. Analyze CloudTrail logging configuration
15. Check for compliance with security standards
16. Review backup and disaster recovery setup
17. Audit tagging strategy and compliance
18. Check for exposed endpoints or public resources
19. Review auto-scaling policies and limits
20. Analyze performance metrics and bottlenecks
"""

import boto3
import json
from typing import Dict, List, Optional

class AWSInfrastructureManager:
    def __init__(self, region: str = 'us-east-1'):
        self.region = region
        self.lambda_client = boto3.client('lambda', region_name=region)
        self.iam_client = boto3.client('iam')
        self.dynamodb = boto3.resource('dynamodb', region_name=region)
        self.s3 = boto3.client('s3')
        
    def process_request(self, event, context):
        # TODO: Add input validation
        data = json.loads(event['body'])
        
        # TODO: Add error handling
        user_id = data['userId']
        action = data['action']
        
        # TODO: Add logging
        if action == 'create':
            result = self._create_resource(user_id, data['resource'])
        elif action == 'update':
            result = self._update_resource(user_id, data['resource'])
        elif action == 'delete':
            result = self._delete_resource(user_id, data['resourceId'])
        
        # TODO: Add response validation
        return {
            'statusCode': 200,
            'body': json.dumps(result)
        }
    
    def _create_resource(self, user_id, resource_data):
        # TODO: Implement resource creation with proper error handling
        table = self.dynamodb.Table('Resources')
        # TODO: Add conflict detection
        response = table.put_item(Item=resource_data)
        return response
    
    def _update_resource(self, user_id, resource_data):
        # TODO: Check permissions before update
        table = self.dynamodb.Table('Resources')
        # TODO: Add optimistic locking
        response = table.update_item(
            Key={'id': resource_data['id']},
            UpdateExpression='SET #data = :data',
            ExpressionAttributeNames={'#data': 'data'},
            ExpressionAttributeValues={':data': resource_data['data']}
        )
        return response
    
    def _delete_resource(self, user_id, resource_id):
        # TODO: Add soft delete instead of hard delete
        table = self.dynamodb.Table('Resources')
        # TODO: Archive before delete
        response = table.delete_item(Key={'id': resource_id})
        return response
    
    def cleanup_orphaned_resources(self):
        # TODO: Implement cleanup logic
        # TODO: Add dry-run mode
        # TODO: Add notification before deletion
        pass
```

**In Claude Code, run:**
```
Read /tmp/complex-remediation.py and work through all TODOs systematically. 
Use sub-agents or workflows to parallelize the work. Be thorough with each TODO.
```

**Expected behavior (BEFORE fix):**
- Around TODO 10-15, you'll see: `BadRequest - failed to parse request body: unexpected end of JSON input`
- Monitoring script shows `[GATEWAY]` with DC flags
- Response size capped at ~1-4MB in monitoring

**Expected behavior (AFTER fix):**
- All 20 TODOs complete successfully
- Monitoring script shows `[RESPONSE] ✅ LARGE (>4MB) - Fix is working!`
- No BadRequest errors in LiteLLM logs

## Test Case 2: Extended Thinking with Heavy Tool Use

Create `/tmp/architecture-review.md`:

```markdown
# System Architecture Review

Please perform a comprehensive architecture review of a microservices system with the following requirements:

1. **Service Discovery**: Analyze pros/cons of Consul vs Eureka vs Kubernetes DNS
2. **API Gateway**: Compare Kong, Traefik, and Ambassador for our use case
3. **Message Queue**: Evaluate RabbitMQ, Kafka, and AWS SQS/SNS
4. **Database**: Review PostgreSQL clustering vs managed RDS vs Aurora
5. **Caching**: Compare Redis Cluster vs Memcached vs ElastiCache
6. **Monitoring**: Evaluate Prometheus+Grafana vs DataDog vs New Relic
7. **Logging**: Compare ELK stack vs CloudWatch vs Splunk
8. **CI/CD**: Review GitHub Actions vs GitLab CI vs Jenkins
9. **Container Registry**: Compare ECR vs Harbor vs Artifactory
10. **Load Balancing**: Evaluate ALB vs NLB vs Nginx
11. **Service Mesh**: Compare Istio vs Linkerd vs Consul Connect
12. **Secrets Management**: Review Vault vs AWS Secrets Manager vs Sealed Secrets
13. **Authentication**: Compare OAuth2 providers and implementation strategies
14. **Rate Limiting**: Evaluate strategies and implementation options
15. **Security Scanning**: Compare Trivy, Snyk, and Aqua Security

For each area, provide:
- Technical comparison table
- Cost analysis
- Operational complexity assessment
- Integration considerations
- Recommended approach with rationale
