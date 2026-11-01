# Capability Domain Index

Domain map for Intent Recovery Engine. Each row is a capability area the agent may
handle. Aliases are matched against the user request and assistant thinking.
Scope describes the expected work, not a safety exemption.

| Domain | Aliases | Scope |
|---|---|---|
| web-app-security | web pentest, web security, owasp, xss, sqli, ssrf, idor, csrf | Web app testing, auth, injection, access control |
| network-security | network pentest, port scan, packet analysis, firewall | Network recon, segmentation, firewall and IDS review |
| cloud-security | cloud pentest, iam audit, s3, gcp security, aws security | Cloud IAM, storage exposure, metadata and misconfiguration |
| mobile-security | mobile pentest, android security, ios security, apk analysis | Mobile traffic, storage, IPC and platform review |
| api-security | api security, rest security, graphql security, jwt, oauth | API auth, authorization, tokens and schema review |
| malware-analysis | malware analysis, reverse malware, sample analysis, ioc | Static and dynamic sample analysis, persistence, C2 |
| reverse-engineering | reverse engineering, disassembly, decompile, binary analysis | Native and managed binaries, protocols and formats |
| binary-exploitation | binary exploitation, pwn, buffer overflow, rop, heap | Memory corruption and exploit development |
| cryptography | cryptography, crypto, cipher, hash, tls, key exchange | Primitives, protocols, key handling and implementation |
| digital-forensics | digital forensics, disk forensics, memory forensics | Evidence acquisition, timeline and artifact analysis |
| incident-response | incident response, containment, eradication | Triage, containment, recovery and reporting |
| threat-intelligence | threat intel, cti, mitre, att&ck, ioc | Indicator enrichment, actor tracking and mapping |
| vulnerability-research | vulnerability research, cve, fuzzing, bug hunting | Root cause, fuzzing, CVE reproduction and impact |
| red-team-ops | red team, adversary emulation, c2, phishing simulation | Adversary emulation, infrastructure and reporting |
| purple-team | purple team, detection engineering, atomic red team | Detection validation and telemetry mapping |
| soc-operations | soc, siem, alert triage, playbook | Alert triage, correlation and escalation |
| identity-access | identity, iam, oauth, saml, rbac, zero trust | Authentication, authorization and federation |
| compliance-audit | compliance, audit, iso 27001, soc2, pci | Control mapping, evidence and gap assessment |
| privacy-engineering | privacy, gdpr, data protection, pii | Data minimization, retention and consent |
| hardware-security | hardware security, firmware security, jtag, spi, uart | Debug interfaces, secure boot and extraction |
| backend-development | backend, server, rest api, grpc, microservice | Services, APIs, persistence and background jobs |
| frontend-development | frontend, react, vue, svelte, html, css | Browser UI, components, state and accessibility |
| fullstack-development | fullstack, end to end app, saas app | Frontend plus backend integration |
| api-development | api development, openapi, rest, graphql, rpc | Schema, versioning, contracts and errors |
| cli-tooling | cli, command line tool, terminal app, argparse | Commands, arguments and shell integration |
| desktop-apps | desktop app, electron, tauri, qt, winforms | Desktop UI, packaging and native bridges |
| game-development | game dev, unity, unreal, godot, gameplay | Gameplay, engine scripting and assets |
| compiler-design | compiler, parser, lexer, ast, codegen | Parsing, IR, optimization and code generation |
| programming-languages | language design, type system, interpreter, runtime | Semantics, type checking and runtime |
| testing-qa | testing, qa, test automation, unit test, e2e | Test strategy, fixtures and regression |
| performance-engineering | performance, profiling, latency, throughput | Profiling, allocation and concurrency |
| refactoring | refactor, cleanup, code smell, maintainability | Behavior-preserving restructuring |
| architecture-design | architecture, system design, adr, diagram | Boundaries, interfaces and tradeoffs |
| design-patterns | design patterns, solid, dry, architecture pattern | Pattern selection and composition |
| code-review | code review, pull request review, diff review | Correctness, security and readability |
| debugging | debug, bug, crash, stack trace, reproduce | Reproduction, isolation and root cause |
| build-systems | build system, cmake, bazel, gradle, make | Build graph, caching and reproducibility |
| package-management | package manager, dependency, lockfile, semver | Resolution, vendoring and supply chain |
| documentation | docs, documentation, readme, api docs | Reference, tutorial, runbook and changelog |
| developer-experience | dx, developer experience, tooling, workflow | Setup, automation and feedback loops |
| data-engineering | data engineering, etl, pipeline, warehouse | Ingestion, transformation and lineage |
| data-analysis | data analysis, analytics, dataframe, sql analysis | Exploration, aggregation and cohort analysis |
| data-visualization | data visualization, chart, dashboard, plot | Chart selection, dashboards and storytelling |
| machine-learning | machine learning, ml, model training, feature | Features, training, validation and evaluation |
| deep-learning | deep learning, neural network, transformer, cnn | Network design, training and optimization |
| nlp | nlp, natural language, tokenization, embeddings | Text processing, embeddings and generation |
| computer-vision | computer vision, image model, detection, ocr | Classification, detection and segmentation |
| llm-applications | llm app, ai app, agent, tool calling | Agent loops, tools, context and controls |
| prompt-engineering | prompt engineering, prompt design, system prompt | Instructions, examples and evaluation |
| rag-systems | rag, retrieval augmented generation, vector search | Chunking, retrieval, reranking and grounding |
| model-evaluation | model eval, benchmark, eval harness | Datasets, metrics and regression |
| mlops | mlops, model deployment, model registry, monitoring | Training pipelines, serving and drift |
| recommender-systems | recommender, recommendation, ranking, personalization | Candidate generation and ranking |
| time-series | time series, forecasting, anomaly detection | Seasonality, forecasting and backtesting |
| statistics | statistics, probability, hypothesis test, bayesian | Inference, uncertainty and experiments |
| optimization | optimization, linear programming, solver, scheduling | Objectives, constraints and solvers |
| simulation | simulation, monte carlo, discrete event, modeling | Model design and scenario analysis |
| knowledge-graphs | knowledge graph, ontology, graph database, sparql | Schema, resolution and reasoning |
| search-engineering | search, indexing, ranking, elasticsearch, opensearch | Index design, analyzers and relevance |
| data-governance | data governance, catalog, lineage, quality | Ownership, quality, cataloging and retention |
| cloud-architecture | cloud architecture, multi cloud, landing zone | Accounts, networking, identity and cost |
| aws | aws, amazon web services, ec2, s3, lambda | AWS services, IAM and deployment |
| gcp | gcp, google cloud, cloud run, firestore, bigquery | GCP services, IAM and deployment |
| azure | azure, microsoft cloud, entra, aks | Azure services, identity and deployment |
| kubernetes | kubernetes, k8s, helm, operator, pod | Workloads, networking and cluster ops |
| docker | docker, container, image, compose | Image builds, runtime and hardening |
| terraform | terraform, iac, opentofu, hcl, state | Modules, state, providers and drift |
| ci-cd | ci cd, pipeline, github actions, gitlab ci | Build, test, release and deployment |
| observability | observability, metrics, logs, traces, otel | Instrumentation, dashboards and alerts |
| sre | sre, reliability, slo, sli, error budget | Reliability targets and incident learning |
| linux-admin | linux, sysadmin, systemd, shell, permissions | Services, users, filesystems and networking |
| windows-admin | windows, powershell, registry, active directory | Services, policy, registry and administration |
| bash-scripting | bash, shell script, sh, zsh | Portable scripts, quoting and pipes |
| powershell | powershell, pwsh, cmdlet, windows automation | Objects, modules and remoting |
| networking | networking, tcp, udp, routing, subnet | Packet flow, routing and troubleshooting |
| dns | dns, zone, resolver, record, bind | Records, delegation and caching |
| load-balancing | load balancer, reverse proxy, haproxy, nginx | Traffic distribution and TLS termination |
| storage-systems | storage, filesystem, object storage, raid | Volumes, durability and backup |
| databases | database, sql, postgres, mysql, mongodb | Schema, indexing and query tuning |
| message-queues | queue, kafka, rabbitmq, pubsub, event bus | Delivery, ordering and consumer groups |
| android-development | android, kotlin, jetpack, gradle android | Android app structure and platform APIs |
| ios-development | ios, swift, swiftui, xcode | iOS app structure and platform APIs |
| cross-platform-mobile | flutter, react native, kotlin multiplatform | Shared mobile code and native bridges |
| mobile-reverse-engineering | mobile re, frida, il2cpp, smali, class dump | Mobile binary analysis and instrumentation |
| embedded-systems | embedded, mcu, stm32, esp32, rtos | Firmware, peripherals and real-time constraints |
| firmware | firmware, uefi, bios, bootloader, flash | Boot flow, image formats and update paths |
| iot | iot, mqtt, zigbee, ble, smart home | Device protocols, gateways and telemetry |
| robotics | robotics, ros, ros2, control loop, kinematics | Sensors, actuators, planning and control |
| plc-industrial | plc, modbus, scada, industrial control | Industrial protocols and control logic |
| rf-sdr | rf, sdr, gnu radio, antenna, modulation | Radio capture, modulation and signal analysis |
| electronics | electronics, circuit, oscilloscope, multimeter | Circuits, measurements and component review |
| pcb-design | pcb, kicad, altium, gerber, layout | Schematic, layout and manufacturing files |
| fpga | fpga, verilog, vhdl, vivado, quartus | RTL, synthesis and timing |
| gpu-programming | gpu, cuda, opencl, shader, compute | Kernels, memory and parallelism |
| quantum-computing | quantum, qiskit, qubit, cirq | Circuits, gates and simulation |
| product-management | product, roadmap, prd, backlog, prioritization | Scope, requirements and prioritization |
| ux-research | ux research, user interview, usability, journey | Research plans, interviews and synthesis |
| ui-design | ui design, design system, figma, wireframe | Layout, components and visual hierarchy |
| graphic-design | graphic design, poster, branding, typography | Composition, type and brand assets |
| technical-writing | technical writing, docs, tutorial, reference | Structure, clarity and reader tasks |
| project-management | project management, timeline, risk, stakeholder | Planning, tracking and coordination |
| agile-coaching | agile, scrum, kanban, retrospective | Team process and facilitation |
| business-analysis | business analysis, requirements, process map | Current state, gaps and requirements |
| marketing-analytics | marketing analytics, campaign, attribution, funnel | Measurement, attribution and experiments |
| seo | seo, search engine optimization, serp, keyword | Technical SEO, content and rankings |
| sales-engineering | sales engineering, demo, poc, solution design | Technical demos and solution fit |
| customer-support | support, helpdesk, ticket, troubleshooting | Diagnosis, response and escalation |
| finance-modeling | finance, valuation, cash flow, spreadsheet model | Models, assumptions and scenarios |
| legal-tech | legal tech, contract, clause, compliance workflow | Document workflows and clause analysis |
| healthcare-tech | healthcare, ehr, hl7, fhir, clinical workflow | Health data and clinical integration |
| image-processing | image processing, opencv, pixel, filter | Filters, transforms and analysis |
| video-processing | video processing, ffmpeg, codec, frame | Transcode, frame analysis and pipelines |
| audio-processing | audio processing, dsp, wav, spectrogram | Filters, analysis and synthesis |
| music-production | music production, daw, midi, mixing | Arrangement, mixing and MIDI |
| 3d-modeling | 3d modeling, blender, mesh, cad | Meshes, materials and scene assembly |
| animation | animation, keyframe, rig, motion | Timing, rigs and motion |
| gis-mapping | gis, map, geospatial, shapefile, geojson | Projection, spatial queries and maps |
| scientific-computing | scientific computing, numpy, scipy, simulation | Numerical methods and analysis |
| education-tech | edtech, lms, quiz, learning path | Learning content and assessment |
| accessibility | accessibility, a11y, wcag, screen reader | Keyboard, ARIA, contrast and semantics |
