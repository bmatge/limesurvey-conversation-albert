/**
 * ConversationIA - Interface de chat pour LimeSurvey
 *
 * Gère l'interface de conversation avec le LLM (Albert API)
 */
(function () {
    'use strict';

    // Configuration globale (injectée par le plugin PHP)
    const config = window.ConversationIAConfig || {
        sendMessageUrl: '',
        endConversationUrl: '',
        maxExchanges: 10,
        labels: {
            send: 'Envoyer',
            end: 'Terminer',
            placeholder: 'Écrivez votre message...',
            thinking: 'L\'assistant réfléchit...',
            ended: 'Conversation terminée.',
            error: 'Une erreur est survenue.'
        }
    };

    /**
     * Classe principale de gestion du chat
     */
    class ConversationIA {
        constructor(container) {
            this.container = container;
            this.questionId = container.dataset.questionId;
            this.sgqa = container.dataset.sgqa;
            this.prompt = container.dataset.prompt;

            // Éléments DOM
            this.messagesContainer = container.querySelector('.conversation-ia-messages');
            this.input = container.querySelector('.conversation-ia-input');
            this.sendButton = container.querySelector('.conversation-ia-send');
            this.endButton = container.querySelector('.conversation-ia-end');
            this.loadingIndicator = container.querySelector('.conversation-ia-loading');
            this.answerField = container.querySelector('.conversation-ia-answer');
            this.historyField = container.querySelector('.conversation-ia-history');

            // État
            this.history = [];
            this.isLoading = false;
            this.isEnded = false;
            this.exchangeCount = 0;

            this.init();
        }

        /**
         * Initialisation
         */
        init() {
            this.bindEvents();
            this.startConversation();
        }

        /**
         * Attacher les événements
         */
        bindEvents() {
            // Bouton envoyer
            this.sendButton.addEventListener('click', () => this.sendMessage());

            // Bouton terminer
            this.endButton.addEventListener('click', () => this.endConversation());

            // Entrée clavier
            this.input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this.sendMessage();
                }
            });

            // Auto-resize du textarea
            this.input.addEventListener('input', () => this.autoResize());
        }

        /**
         * Démarrer la conversation (premier message de l'IA)
         */
        async startConversation() {
            this.setLoading(true);

            try {
                const response = await this.callAPI(config.sendMessageUrl, {
                    message: '[DEBUT_CONVERSATION]',
                    history: [],
                    prompt: this.prompt
                });

                if (response.success) {
                    this.addMessage('assistant', response.message);
                    this.history.push({ role: 'assistant', content: response.message });
                    this.updateHistoryField();
                } else {
                    this.showError(response.error || config.labels.error);
                }
            } catch (error) {
                console.error('ConversationIA: Erreur au démarrage', error);
                this.showError(config.labels.error);
            }

            this.setLoading(false);
            // Ne pas prendre le focus automatiquement pour ne pas perturber la navigation
        }

        /**
         * Envoyer un message utilisateur
         */
        async sendMessage() {
            if (this.isLoading || this.isEnded) return;

            const message = this.input.value.trim();
            if (!message) return;

            // Afficher le message utilisateur
            this.addMessage('user', message);
            this.history.push({ role: 'user', content: message });
            this.input.value = '';
            this.autoResize();
            this.exchangeCount++;

            this.setLoading(true);

            try {
                const response = await this.callAPI(config.sendMessageUrl, {
                    message: message,
                    history: JSON.stringify(this.history),
                    prompt: this.prompt
                });

                if (response.success) {
                    this.addMessage('assistant', response.message);
                    this.history.push({ role: 'assistant', content: response.message });
                    this.updateHistoryField();

                    // Vérifier si la conversation doit se terminer
                    if (response.shouldEnd) {
                        await this.endConversation(true);
                    }
                } else {
                    this.showError(response.error || config.labels.error);
                }
            } catch (error) {
                console.error('ConversationIA: Erreur envoi message', error);
                this.showError(config.labels.error);
            }

            this.setLoading(false);

            if (!this.isEnded) {
                this.input.focus();
            }
        }

        /**
         * Terminer la conversation et générer le résumé
         */
        async endConversation(automatic = false) {
            if (this.isEnded) return;

            this.setLoading(true);

            let summary = null;

            try {
                const response = await this.callAPI(config.endConversationUrl, {
                    history: JSON.stringify(this.history),
                    prompt: this.prompt
                });

                if (response.success) {
                    summary = response.summary;
                }
            } catch (error) {
                console.error('ConversationIA: Erreur génération résumé, utilisation du fallback', error);
            }

            // Fallback : si pas de résumé IA, générer un résumé basique de l'historique
            if (!summary) {
                summary = this.generateFallbackSummary();
            }

            // Stocker le résumé dans le champ de réponse
            this.answerField.value = summary;

            // Marquer comme terminé
            this.isEnded = true;
            this.showEndMessage(automatic);
            this.disableInput();

            this.setLoading(false);
        }

        /**
         * Générer un résumé de secours à partir de l'historique
         */
        generateFallbackSummary() {
            const userMessages = this.history
                .filter(msg => msg.role === 'user')
                .map(msg => msg.content);

            if (userMessages.length === 0) {
                return 'Aucune réponse enregistrée.';
            }

            return 'Réponses de l\'utilisateur :\n- ' + userMessages.join('\n- ');
        }

        /**
         * Appel AJAX vers le plugin avec retry automatique
         * @param {string} url - URL de l'endpoint
         * @param {object} data - Données à envoyer
         * @param {number} retries - Nombre de tentatives restantes (défaut: 2)
         */
        async callAPI(url, data, retries = 2) {
            const formData = new FormData();
            for (const key in data) {
                formData.append(key, data[key]);
            }

            // Ajouter le token CSRF si disponible
            const csrfToken = document.querySelector('input[name="YII_CSRF_TOKEN"]');
            if (csrfToken) {
                formData.append('YII_CSRF_TOKEN', csrfToken.value);
            }

            try {
                const response = await fetch(url, {
                    method: 'POST',
                    body: formData,
                    credentials: 'same-origin'
                });

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }

                return await response.json();
            } catch (error) {
                // Retry silencieux en cas d'erreur
                if (retries > 0) {
                    console.log(`ConversationIA: Retry (${retries} restantes)...`);
                    // Attendre un peu avant de réessayer (500ms)
                    await new Promise(resolve => setTimeout(resolve, 500));
                    return this.callAPI(url, data, retries - 1);
                }
                throw error;
            }
        }

        /**
         * Ajouter un message à l'interface
         */
        addMessage(role, content) {
            const messageDiv = document.createElement('div');
            messageDiv.className = `conversation-ia-message conversation-ia-message--${role}`;

            const roleLabel = role === 'user' ? 'Vous' : 'Assistant';
            const roleClass = role === 'user' ? 'fr-badge--green-menthe' : 'fr-badge--blue-france';

            messageDiv.innerHTML = `
                <div class="conversation-ia-message__header">
                    <span class="fr-badge ${roleClass} fr-badge--sm">${roleLabel}</span>
                </div>
                <div class="conversation-ia-message__content">
                    ${this.formatMessage(content)}
                </div>
            `;

            this.messagesContainer.appendChild(messageDiv);
            this.scrollToBottom();
        }

        /**
         * Formater le contenu du message (markdown basique)
         */
        formatMessage(content) {
            // Échapper le HTML
            let formatted = content
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');

            // Convertir les sauts de ligne
            formatted = formatted.replace(/\n/g, '<br>');

            // Gras **texte**
            formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

            // Italique *texte*
            formatted = formatted.replace(/\*(.*?)\*/g, '<em>$1</em>');

            return formatted;
        }

        /**
         * Afficher un message d'erreur
         */
        showError(message) {
            const errorDiv = document.createElement('div');
            errorDiv.className = 'conversation-ia-error fr-alert fr-alert--error fr-alert--sm';
            errorDiv.innerHTML = `<p>${message}</p>`;
            this.messagesContainer.appendChild(errorDiv);
            this.scrollToBottom();
        }

        /**
         * Afficher le message de fin
         */
        showEndMessage(automatic) {
            const endDiv = document.createElement('div');
            endDiv.className = 'conversation-ia-ended fr-alert fr-alert--success fr-alert--sm';

            const text = automatic
                ? config.labels.ended
                : 'Conversation terminée à votre demande. Merci pour vos réponses.';

            endDiv.innerHTML = `<p>${text}</p>`;
            this.messagesContainer.appendChild(endDiv);
            this.scrollToBottom();
        }

        /**
         * Activer/désactiver le loading
         */
        setLoading(loading) {
            this.isLoading = loading;

            if (loading) {
                this.loadingIndicator.classList.remove('fr-hidden');
                this.sendButton.disabled = true;
                this.endButton.disabled = true;
                this.input.disabled = true;
            } else {
                this.loadingIndicator.classList.add('fr-hidden');
                this.sendButton.disabled = false;
                this.endButton.disabled = false;
                this.input.disabled = false;
            }
        }

        /**
         * Désactiver définitivement l'input
         */
        disableInput() {
            this.input.disabled = true;
            this.sendButton.disabled = true;
            this.endButton.disabled = true;
            this.input.placeholder = 'Conversation terminée';
        }

        /**
         * Scroll vers le bas du chat
         */
        scrollToBottom() {
            this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
        }

        /**
         * Auto-resize du textarea
         */
        autoResize() {
            this.input.style.height = 'auto';
            this.input.style.height = Math.min(this.input.scrollHeight, 150) + 'px';
        }

        /**
         * Mettre à jour le champ historique caché
         */
        updateHistoryField() {
            this.historyField.value = JSON.stringify(this.history);
        }
    }

    /**
     * Initialisation au chargement de la page
     */
    function initConversationIA() {
        const containers = document.querySelectorAll('.conversation-ia-container');

        containers.forEach(container => {
            // Éviter la double initialisation
            if (container.dataset.initialized) return;
            container.dataset.initialized = 'true';

            new ConversationIA(container);
        });
    }

    // Initialiser quand le DOM est prêt
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initConversationIA);
    } else {
        initConversationIA();
    }

    // Exposer pour usage externe si nécessaire
    window.ConversationIA = ConversationIA;

})();
