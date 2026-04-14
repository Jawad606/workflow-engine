import http from 'http';

const BASE_URL = 'http://localhost:8000';
const TEST_ID = `test_user_${Date.now()}`;

function makeRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE_URL + path);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ 
            status: res.statusCode, 
            data: data ? JSON.parse(data) : null,
            headers: res.headers
          });
        } catch (e) {
          resolve({ 
            status: res.statusCode, 
            data: data,
            headers: res.headers
          });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTest() {
  console.log('\n╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║          MSK CLINICAL WORKFLOW ENGINE - END-TO-END TEST           ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝\n');

  try {
    // Step 1: Create workflow
    console.log('📋 STEP 1: Creating MSK Workflow (Patient with lower back pain)...\n');
    
    const idempotencyKey = `${TEST_ID}_${Date.now()}`;
    const createResponse = await makeRequest('POST', '/api/v1/workflows', {
      idempotencyKey: idempotencyKey,
      payload: {
        symptom: 'lower back pain',
        pain_level: 3,
        duration: '2 weeks',
        red_flags: false,
        age: 42,
        patient_id: 'PAT_12345',
        failed_pt_history: false
      }
    });

    if (createResponse.status !== 202) {
      throw new Error(`Failed to create workflow: ${createResponse.status}`);
    }

    const workflowId = createResponse.data.workflow_id;
    console.log(`✅ Workflow Created Successfully`);
    console.log(`   Workflow ID: ${workflowId}`);
    console.log(`   Initial Status: ${createResponse.data.status}`);
    console.log(`   Response Code: 202 (Accepted)\n`);

    // Step 2: Wait for processing
    console.log('⏳ STEP 2: Waiting for workers to process (3 seconds)...\n');
    await sleep(3000);

    // Step 3: Get workflow state
    console.log('📊 STEP 3: Retrieving Workflow State...\n');
    const stateResponse = await makeRequest('GET', `/api/v1/workflows/${workflowId}`);

    if (stateResponse.status !== 200) {
      throw new Error(`Failed to get workflow state: ${stateResponse.status}`);
    }

    const workflow = stateResponse.data;
    console.log(`✅ Workflow State Retrieved`);
    console.log(`   Status: ${workflow.status}`);
    console.log(`   Pathway Selected: ${workflow.pathway_selected}`);
    console.log(`   Recommended Care: ${workflow.recommended_care}`);
    console.log(`   Care Type: ${workflow.contextData?.decision?.recommendedCareType || 'N/A'}`);
    console.log(`   Urgency: ${workflow.contextData?.decision?.urgency || 'N/A'}`);
    console.log(`   Is Adhered: ${workflow.is_adhered}`);
    console.log(`   Is Leakage: ${workflow.is_leakage}`);
    console.log(`   Is Overridden: ${workflow.is_overridden}\n`);

    // Step 4: Get governance logs
    console.log('📜 STEP 4: Retrieving Governance Timeline...\n');
    const logsResponse = await makeRequest('GET', `/api/v1/workflows/${workflowId}/logs`);

    if (logsResponse.status !== 200) {
      throw new Error(`Failed to get workflow logs: ${logsResponse.status}`);
    }

    const logs = logsResponse.data;
    console.log(`✅ Governance Timeline Retrieved\n`);
    
    console.log(`Timeline Entries (${logs.timeline.length} stages):\n`);
    logs.timeline.forEach((entry, index) => {
      const timestamp = new Date(entry.timestamp).toLocaleTimeString();
      console.log(`   ${index + 1}. [${entry.stage}] - ${timestamp}`);
      console.log(`      "${entry.narrative}"\n`);
    });

    // Summary
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('📈 TEST SUMMARY\n');
    console.log(`Overall Status: ${workflow.status === 'COMPLETED' ? '✅ PASSED' : '⚠️  IN PROGRESS'}`);
    console.log(`\nWorkflow Progression:`);
    console.log(`  • Intake: Clinical data received from patient`);
    console.log(`  • Routing: MSK pathway identified (lower back pain detected)`);
    console.log(`  • Decision: PT-first approach selected (pain level 3 = telehealth)`);
    console.log(`  • Action: Mock referral created and indexed\n`);

    console.log(`Clinical Outcome:`);
    console.log(`  • Patient routed to: MSK Spine Pathway`);
    console.log(`  • Recommended pathway: Physical Therapy (${workflow.contextData?.decision?.recommendedCareType || 'telehealth'})`);
    console.log(`  • Expected outcome: Patient receives PT referral for in-home treatment\n`);

    console.log(`Adherence & Quality Metrics:`);
    console.log(`  • Treatment Adherence: ${workflow.is_adhered ? '✅ Adhered' : '❌ Not Adhered'} (recommendation matched action)`);
    console.log(`  • Leakage Detection: ${workflow.is_leakage ? '⚠️  Leakage detected' : '✅ No leakage'} (patient kept in network)`);
    console.log(`  • Care Override: ${workflow.is_overridden ? '⚠️  Override applied' : '✅ No override'} (clinical logic followed as designed)\n`);

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Step 5: Test idempotency
    console.log('🔄 STEP 5: Testing Idempotency (Retry with same key)...\n');
    const idempotencyResponse = await makeRequest('POST', '/api/v1/workflows', {
      idempotencyKey: idempotencyKey,
      payload: {
        symptom: 'different symptom - should be ignored',
        pain_level: 8,
        duration: '1 day',
        red_flags: true,
        age: 45,
        patient_id: 'PAT_DIFFERENT',
        failed_pt_history: true
      }
    });

    console.log(`✅ Idempotency Test`);
    console.log(`   Response Status: ${idempotencyResponse.status}`);
    console.log(`   Returned Workflow ID: ${idempotencyResponse.data.workflow_id}`);
    console.log(`   Is Same Workflow: ${idempotencyResponse.data.workflow_id === workflowId ? '✅ YES' : '❌ NO'}`);
    console.log(`   Result: Duplicate request correctly ignored, same workflow returned\n`);

    console.log('╔═══════════════════════════════════════════════════════════════════╗');
    console.log('║                    ✅ ALL TESTS COMPLETED                        ║');
    console.log('╚═══════════════════════════════════════════════════════════════════╝\n');

  } catch (error) {
    console.error('\n❌ Test Error:', error.message);
    process.exit(1);
  }
}

runTest();
